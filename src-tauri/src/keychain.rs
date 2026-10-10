//! The vault key in the operating system's keychain, when asked for.
//!
//! Off unless the operator turns it on, per machine. On, the key that opens
//! the vault — never the passphrase — is kept in Windows Credential Manager,
//! the macOS Keychain or the Secret Service on Linux, and the vault opens by
//! itself when Corelens starts. A kept key is used only if it opens this
//! vault's verifier; one left from a vault since discarded is forgotten rather
//! than tried again.

use corelens_discover::vault::{self, VaultHeader, VaultKey};

pub const SERVICE: &str = "Corelens Desktop";
pub const ACCOUNT: &str = "vault-key";
/// The service names the key was kept under before the app was renamed.
pub const PREVIOUS_SERVICES: &[&str] = &["Coreview"];

/// The one entry Corelens keeps.
pub fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("The system keychain is not available: {e}"))
}

/// The entries an earlier name of the app may have left a key in.
pub fn previous_entries() -> Vec<keyring::Entry> {
    PREVIOUS_SERVICES.iter().filter_map(|service| keyring::Entry::new(service, ACCOUNT).ok()).collect()
}

pub fn remember(entry: &keyring::Entry, key: &VaultKey) -> Result<(), String> {
    entry
        .set_secret(&vault::key_bytes(key))
        .map_err(|e| format!("The key could not be kept in the system keychain: {e}"))
}

/// What the keychain had.
pub enum Recalled {
    Opened(VaultKey),
    NothingKept,
    /// Something was kept, but it does not open this vault; it has been
    /// removed.
    Stale,
}

pub fn recall(entry: &keyring::Entry, header: &VaultHeader) -> Result<Recalled, String> {
    let bytes = match entry.get_secret() {
        Ok(b) => zeroize::Zeroizing::new(b),
        Err(keyring::Error::NoEntry) => return Ok(Recalled::NothingKept),
        Err(e) => return Err(format!("The system keychain could not be read: {e}")),
    };
    match vault::unlock_with_key(&bytes, header) {
        Ok(key) => Ok(Recalled::Opened(key)),
        Err(_) => {
            forget(entry)?;
            Ok(Recalled::Stale)
        }
    }
}

/// `recall`, and when nothing is kept under the current name, a key an
/// earlier name kept is read, moved across and used — so the vault still
/// opens by itself after the rename, and no key is left behind under a name
/// nothing reads any more. One the keychain cannot read is passed over: the
/// passphrase still opens the vault.
pub fn recall_or_adopt(entry: &keyring::Entry, previous: &[keyring::Entry], header: &VaultHeader) -> Result<Recalled, String> {
    match recall(entry, header)? {
        Recalled::NothingKept => {}
        found => return Ok(found),
    }
    for old in previous {
        let Ok(Recalled::Opened(key)) = recall(old, header) else { continue };
        remember(entry, &key)?;
        let _ = forget(old);
        return Ok(Recalled::Opened(key));
    }
    Ok(Recalled::NothingKept)
}

/// Removes the kept key. Nothing kept is not an error.
pub fn forget(entry: &keyring::Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("The key could not be removed from the system keychain: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock() -> keyring::Entry {
        mock_under(SERVICE)
    }

    fn mock_under(service: &str) -> keyring::Entry {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        keyring::Entry::new(service, ACCOUNT).unwrap()
    }

    /// A key Coreview kept still opens the vault after the rename, and is
    /// moved under the new name rather than left behind.
    #[test]
    fn a_key_kept_under_the_earlier_name_is_moved_across() {
        let entry = mock();
        let old = mock_under(PREVIOUS_SERVICES[0]);
        let (header, key) = vault::create("correct horse battery staple").unwrap(); // not a credential
        remember(&old, &key).unwrap();

        let Recalled::Opened(opened) = recall_or_adopt(&entry, std::slice::from_ref(&old), &header).unwrap() else {
            panic!("the earlier name's key should open the vault")
        };
        let sealed = vault::seal(&key, "a secret").unwrap();
        assert_eq!(vault::open(&opened, &sealed).unwrap(), "a secret");
        assert!(matches!(recall(&entry, &header).unwrap(), Recalled::Opened(_)), "kept under the new name");
        assert!(matches!(recall(&old, &header).unwrap(), Recalled::NothingKept), "and gone from the old one");
    }

    #[test]
    fn the_current_name_comes_first_and_nothing_anywhere_is_nothing() {
        let entry = mock();
        let old = mock_under(PREVIOUS_SERVICES[0]);
        let (header, key) = vault::create("correct horse battery staple").unwrap(); // not a credential
        assert!(matches!(recall_or_adopt(&entry, std::slice::from_ref(&old), &header).unwrap(), Recalled::NothingKept));

        remember(&entry, &key).unwrap();
        remember(&old, &key).unwrap();
        assert!(matches!(recall_or_adopt(&entry, std::slice::from_ref(&old), &header).unwrap(), Recalled::Opened(_)));
        assert!(matches!(recall(&old, &header).unwrap(), Recalled::Opened(_)), "the old entry is not touched when the new one answers");
    }

    /// The machine's real keychain, under a test account: `cargo test -p
    /// corelens real_keychain -- --ignored` with a Secret Service, Credential
    /// Manager or Keychain available.
    #[test]
    #[ignore]
    fn the_real_keychain_keeps_and_forgets_a_key() {
        let entry = keyring::Entry::new(SERVICE, "vault-key-test").unwrap();
        let (header, key) = vault::create("correct horse battery staple").unwrap();
        remember(&entry, &key).unwrap();
        assert!(matches!(recall(&entry, &header).unwrap(), Recalled::Opened(_)), "kept and read back");
        forget(&entry).unwrap();
        assert!(matches!(recall(&entry, &header).unwrap(), Recalled::NothingKept), "and gone");
    }

    #[test]
    fn a_kept_key_opens_its_own_vault_and_only_that() {
        let entry = mock();
        let passphrase = "correct horse battery staple"; // not a credential
        let (header, key) = vault::create(passphrase).unwrap();
        assert!(matches!(recall(&entry, &header).unwrap(), Recalled::NothingKept));

        remember(&entry, &key).unwrap();
        let Recalled::Opened(opened) = recall(&entry, &header).unwrap() else { panic!("the kept key should open the vault") };
        let sealed = vault::seal(&key, "a secret").unwrap();
        assert_eq!(vault::open(&opened, &sealed).unwrap(), "a secret");

        // A new vault: the old key must not open it, and is forgotten.
        let (other, _) = vault::create(passphrase).unwrap();
        assert!(matches!(recall(&entry, &other).unwrap(), Recalled::Stale));
        assert!(matches!(recall(&entry, &other).unwrap(), Recalled::NothingKept));

        remember(&entry, &key).unwrap();
        forget(&entry).unwrap();
        forget(&entry).unwrap();
        assert!(matches!(recall(&entry, &header).unwrap(), Recalled::NothingKept));
    }
}
