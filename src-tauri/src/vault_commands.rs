//! IPC for the credential vault.
//!
//! **No command returns a secret.** Credentials go in and references come
//! back; a stored password, community or key never crosses to the interface
//! again, in any form. A secret is visible while it is being typed and at no
//! other time. Someone who needs to know what is stored replaces it.
//!
//! That is an architectural promise rather than a rendering one, and a test
//! holds it: `no_command_returns_a_secret` reads this file and fails if any
//! command's return type could carry one.
//!
//! **A login belongs to one project.** Every lookup names the project, the
//! project is the one the window has open, and with none open nothing is
//! listed, saved or opened.
//!
//! The unlocked key lives in memory for the length of the app session and is
//! zeroed when it is dropped. It is never written anywhere.

use corelens_discover::snmp::{AuthKind, PrivKind, SnmpAuth};
use corelens_discover::ssh::{Credentials, Secret};
use corelens_discover::vault::{self, SealedSecret, VaultHeader, VaultKey};
use serde::Deserialize;
use tauri::State;

use crate::commands::AppState;
use crate::db;

type CmdResult<T> = Result<T, String>;

/// What every login command says with no project open.
const NO_PROJECT_OPEN: &str = "Open a project first: a saved login belongs to one project.";

/// The open project's login `id`, sealed. The one way this file reaches a
/// stored secret, so the one place the project is checked.
fn own_login(state: &AppState, id: &str) -> CmdResult<db::StoredCredential> {
    let conn = state.db.lock().map_err(db_err)?;
    let project = db::may_use_credential(&conn, crate::commands::open_project(state).as_deref(), id)?;
    db::credential(&conn, &project, id)
        .map_err(db_err)?
        .ok_or_else(|| "That saved credential no longer exists.".to_string())
}

pub fn db_err(e: impl std::fmt::Display) -> String {
    format!("Local database error: {e}")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// What the interface is allowed to know about the vault.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub exists: bool,
    pub unlocked: bool,
    /// How many logins the open project has; none with no project open.
    pub credentials: usize,
    /// Every login on this machine, as a number only — what discarding the
    /// vault would discard.
    pub all_credentials: usize,
    /// Logins that belong to no project: left from before a login had an
    /// owner, or by a project deleted before deleting took them along.
    pub unowned_credentials: usize,
    pub minimum_passphrase: usize,
    /// Whether this machine keeps the vault key in its keychain.
    pub kept_in_keychain: bool,
}

/// The setting that says the key is kept in the keychain, so the
/// keychain is only asked when it holds something — on macOS asking can show
/// a prompt.
const KEYCHAIN_SETTING: &str = "vaultKeyInKeychain";

fn kept_in_keychain(conn: &rusqlite::Connection) -> CmdResult<bool> {
    Ok(db::all_settings(conn).map_err(db_err)?.get(KEYCHAIN_SETTING).is_some_and(|v| v == "1"))
}

/// Keeps the unlocked vault's key in the system keychain, so the vault
/// opens by itself on this machine from now on.
#[tauri::command(async)]
pub fn remember_vault_key(state: State<'_, AppState>) -> CmdResult<()> {
    let guard = state.vault_key.lock().map_err(db_err)?;
    let key = guard.as_ref().ok_or("Unlock the vault first; the key is kept only once it is open.")?;
    crate::keychain::remember(&crate::keychain::entry()?, key)?;
    let conn = state.db.lock().map_err(db_err)?;
    db::set_setting(&conn, KEYCHAIN_SETTING, Some("1")).map_err(db_err)
}

/// Removes the key from the keychain; the passphrase is needed again.
#[tauri::command(async)]
pub fn forget_vault_key(state: State<'_, AppState>) -> CmdResult<()> {
    crate::keychain::forget(&crate::keychain::entry()?)?;
    for old in crate::keychain::previous_entries() {
        let _ = crate::keychain::forget(&old);
    }
    let conn = state.db.lock().map_err(db_err)?;
    db::set_setting(&conn, KEYCHAIN_SETTING, None).map_err(db_err)
}

/// Opens the vault with the kept key, when this machine keeps one.
/// `opened`, `off` (nothing kept here), or `stale` (what was kept no longer
/// opens this vault, and has been removed).
#[tauri::command(async)]
pub fn unlock_vault_from_keychain(state: State<'_, AppState>) -> CmdResult<String> {
    let header = {
        let conn = state.db.lock().map_err(db_err)?;
        if !kept_in_keychain(&conn)? {
            return Ok("off".into());
        }
        match db::vault_header(&conn).map_err(db_err)? {
            Some((salt, verifier)) => VaultHeader { salt, verifier },
            None => return Ok("off".into()),
        }
    };
    let outcome = crate::keychain::recall_or_adopt(&crate::keychain::entry()?, &crate::keychain::previous_entries(), &header)?;
    Ok(match outcome {
        crate::keychain::Recalled::Opened(key) => {
            *state.vault_key.lock().map_err(db_err)? = Some(key);
            "opened".into()
        }
        crate::keychain::Recalled::NothingKept | crate::keychain::Recalled::Stale => {
            // Taken only here: the database is never held while the vault
            // is being locked.
            let conn = state.db.lock().map_err(db_err)?;
            db::set_setting(&conn, KEYCHAIN_SETTING, None).map_err(db_err)?;
            "stale".into()
        }
    })
}

/// A saved credential as the interface sees it: everything except the secrets.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSummary {
    pub id: String,
    pub label: String,
    /// "ssh" or "snmp".
    pub kind: String,
    pub username: String,
    /// Algorithm words for SNMPv3. Not secret, and needed to show what a
    /// credential is configured for.
    pub detail: String,
    /// Whether a second secret is stored — an enable password, or an SNMPv3
    /// privacy password. Whether one exists is not itself a secret, and the
    /// interface needs it to render honestly.
    pub has_second_secret: bool,
}

#[tauri::command(async)]
pub fn vault_status(state: State<'_, AppState>) -> CmdResult<VaultStatus> {
    // Read before the database is taken: the vault comes first wherever
    // both are wanted.
    let unlocked = state.vault_key.lock().map_err(db_err)?.is_some();
    let conn = state.db.lock().map_err(db_err)?;
    let exists = db::vault_header(&conn).map_err(db_err)?.is_some();
    let credentials = match crate::commands::open_project(&state) {
        Some(project) => db::list_credentials(&conn, &project).map_err(db_err)?.len(),
        None => 0,
    };
    Ok(VaultStatus {
        exists,
        unlocked,
        credentials,
        all_credentials: db::count_credentials(&conn).map_err(db_err)?,
        unowned_credentials: db::unowned_credentials(&conn).map_err(db_err)?,
        minimum_passphrase: vault::MIN_PASSPHRASE,
        kept_in_keychain: kept_in_keychain(&conn)?,
    })
}

/// Creates the vault and leaves it unlocked for this session.
#[tauri::command(async)]
pub fn create_vault(state: State<'_, AppState>, passphrase: String) -> CmdResult<()> {
    // The vault before the database, wherever both are held.
    let mut slot = state.vault_key.lock().map_err(db_err)?;
    let conn = state.db.lock().map_err(db_err)?;
    if db::vault_header(&conn).map_err(db_err)?.is_some() {
        return Err("A vault already exists. Unlock it, or discard it and start again.".into());
    }
    let (header, key) = vault::create(&passphrase).map_err(|e| e.to_string())?;
    db::create_vault(&conn, &header.salt, &header.verifier, now_ms()).map_err(db_err)?;
    *slot = Some(key);
    Ok(())
}

#[tauri::command(async)]
pub fn unlock_vault(state: State<'_, AppState>, passphrase: String) -> CmdResult<()> {
    let header = {
        let conn = state.db.lock().map_err(db_err)?;
        db::vault_header(&conn)
            .map_err(db_err)?
            .ok_or("There is no vault yet. Create one before unlocking it.")?
    };
    let key = vault::unlock(
        &passphrase,
        &VaultHeader {
            salt: header.0,
            verifier: header.1,
        },
    )
    .map_err(|e| e.to_string())?;
    *state.vault_key.lock().map_err(db_err)? = Some(key);
    Ok(())
}

/// Locks the vault, dropping the key.
#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> CmdResult<()> {
    // Dropping it zeroes it — VaultKey is ZeroizeOnDrop.
    *state.vault_key.lock().map_err(db_err)? = None;
    Ok(())
}

/// Discards the vault and everything in it.
///
/// The only way past a forgotten passphrase, and destructive by necessity:
/// without the key the stored rows are unreadable, so keeping them would be
/// keeping rubbish, and leaving them would make a new vault look like it had
/// contents. Returns how many credentials went, for the confirmation.
#[tauri::command(async)]
pub fn discard_vault(state: State<'_, AppState>) -> CmdResult<usize> {
    // The vault before the database, wherever both are held.
    let mut slot = state.vault_key.lock().map_err(db_err)?;
    let conn = state.db.lock().map_err(db_err)?;
    let removed = db::destroy_vault(&conn).map_err(db_err)?;
    *slot = None;
    drop(slot);
    // A key kept for the vault that is gone goes with it.
    if kept_in_keychain(&conn)? {
        if let Ok(entry) = crate::keychain::entry() {
            let _ = crate::keychain::forget(&entry);
        }
        for old in crate::keychain::previous_entries() {
            let _ = crate::keychain::forget(&old);
        }
        db::set_setting(&conn, KEYCHAIN_SETTING, None).map_err(db_err)?;
    }
    Ok(removed)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveCredential {
    /// Absent for a new credential.
    pub id: Option<String>,
    pub label: String,
    /// "ssh" or "snmp".
    pub kind: String,
    pub username: String,
    pub secret: String,
    /// Enable password, or SNMPv3 privacy password.
    pub second_secret: Option<String>,
    /// SNMPv3 algorithm words, for example "sha|aes 256"; for an API login,
    /// its HTTPS port.
    pub detail: Option<String>,
}

#[tauri::command(async)]
pub fn save_credential(state: State<'_, AppState>, credential: SaveCredential) -> CmdResult<String> {
    let guard = state.vault_key.lock().map_err(db_err)?;
    let key = guard.as_ref().ok_or_else(|| vault::VaultError::Locked.to_string())?;

    let sealed = vault::seal(key, &credential.secret).map_err(|e| e.to_string())?;
    let extra = match credential.second_secret.filter(|s| !s.is_empty()) {
        None => None,
        Some(s) => {
            let e = vault::seal(key, &s).map_err(|err| err.to_string())?;
            Some((e.nonce, e.ciphertext))
        }
    };

    let id = credential
        .id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let stored = db::StoredCredential {
        id: id.clone(),
        label: credential.label,
        kind: credential.kind,
        username: credential.username,
        secret: (sealed.nonce, sealed.ciphertext),
        extra,
        detail: credential.detail.unwrap_or_default(),
    };

    // Into the open project, and only there. An id that another project
    // also uses is that project's own row and is not touched.
    let project = crate::commands::open_project(&state).ok_or(NO_PROJECT_OPEN)?;
    let conn = state.db.lock().map_err(db_err)?;
    db::save_credential(&conn, &project, &stored, now_ms()).map_err(db_err)?;
    Ok(id)
}

/// Removes the logins that belong to no project. They cannot be listed,
/// used or handed to a project — a login is typed into the project it is
/// for — so the one thing left to do with them is this. Returns how many went.
#[tauri::command(async)]
pub fn delete_unowned_credentials(state: State<'_, AppState>) -> CmdResult<usize> {
    let conn = state.db.lock().map_err(db_err)?;
    db::delete_unowned_credentials(&conn).map_err(db_err)
}

/// The saved credentials, without their secrets.
///
/// Works while locked, on purpose: knowing that a credential called "Core
/// switches" exists is not the same as knowing its password, and a list that
/// vanished when locked would make the vault unusable to reason about.
///
/// The open project's, and no other's. With no project open there are none
/// to list: the start screen is not a project.
#[tauri::command(async)]
pub fn list_credentials(state: State<'_, AppState>) -> CmdResult<Vec<CredentialSummary>> {
    let Some(project) = crate::commands::open_project(&state) else { return Ok(Vec::new()) };
    let conn = state.db.lock().map_err(db_err)?;
    let rows = db::list_credentials(&conn, &project).map_err(db_err)?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, label, kind, username, detail) in rows {
        // Only to report whether one exists — the value is not read.
        let has_second_secret = db::credential(&conn, &project, &id)
            .map_err(db_err)?
            .map(|c| c.extra.is_some())
            .unwrap_or(false);
        out.push(CredentialSummary { id, label, kind, username, detail, has_second_secret });
    }
    Ok(out)
}

#[tauri::command(async)]
pub fn delete_credential(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let conn = state.db.lock().map_err(db_err)?;
    let project = db::may_use_credential(&conn, crate::commands::open_project(&state).as_deref(), &id)?;
    db::delete_credential(&conn, &project, &id).map_err(db_err)?;
    Ok(())
}

/// The vault as a portable bundle, still encrypted.
///
/// Exists so credentials can move to another machine deliberately. What comes
/// out is ciphertext and the salt needed to derive the key again — importing it
/// requires the same passphrase, so this is not a way to read secrets.
///
/// It is still the most dangerous thing the app can write: it is every stored
/// credential in one file, and its safety rests entirely on the passphrase. The
/// interface defaults to leaving it out and says so plainly.
///
/// Only the open project's logins travel, and of those only the ones `ids`
/// names when it is given. A package exported from one project once carried
/// every credential the vault held, other projects' included.
#[tauri::command(async)]
pub fn export_vault(state: State<'_, AppState>, ids: Option<Vec<String>>) -> CmdResult<serde_json::Value> {
    // Only with the vault open. It hands out ciphertext and the salt, which
    // is everything a passphrase would be guessed against — not something to
    // give to whoever reaches a locked app.
    if state.vault_key.lock().map_err(db_err)?.is_none() {
        return Err(vault::VaultError::Locked.to_string());
    }
    let conn = state.db.lock().map_err(db_err)?;
    let (salt, verifier) = db::vault_header(&conn)
        .map_err(db_err)?
        .ok_or("There is no vault to export.")?;

    let project = crate::commands::open_project(&state).ok_or(NO_PROJECT_OPEN)?;
    let all: Vec<String> = db::list_credentials(&conn, &project).map_err(db_err)?.into_iter().map(|(id, ..)| id).collect();
    let mut items = Vec::new();
    for id in chosen(&all, ids.as_deref()) {
        if let Some(c) = db::credential(&conn, &project, &id).map_err(db_err)? {
            items.push(serde_json::json!({
                "id": c.id,
                "label": c.label,
                "kind": c.kind,
                "username": c.username,
                "detail": c.detail,
                "secretNonce": c.secret.0,
                "secretCipher": c.secret.1,
                "extraNonce": c.extra.as_ref().map(|e| e.0.clone()),
                "extraCipher": c.extra.as_ref().map(|e| e.1.clone()),
            }));
        }
    }

    Ok(serde_json::json!({
        "vaultVersion": 1,
        "salt": salt,
        "verifier": verifier,
        "credentials": items,
    }))
}

/// Takes the credentials out of an exported project package.
///
/// The credentials in that file are sealed under the *exporting* machine's
/// key, so importing them needs that machine's passphrase — there is no way
/// around it, and no way to check the file is worth importing without it.
/// Each secret is opened with the imported key and resealed under this
/// vault's, so nothing on disk here is ever encrypted with someone else's
/// passphrase.
///
/// Requires the local vault to be unlocked: this writes into it.
///
/// With `check_only`, everything is opened and re-sealed but nothing is
/// written and no project is needed: the start screen asks this before it
/// makes the imported project, so a wrong passphrase is said where it was
/// typed, and then imports into the project it has just opened.
#[tauri::command(async)]
pub fn import_vault(
    state: State<'_, AppState>,
    vault: serde_json::Value,
    passphrase: String,
    check_only: Option<bool>,
) -> CmdResult<ImportedVault> {
    // Into the open project: an imported login is that project's. Asked
    // here and needed only for the writing, so a check works with none.
    let project = crate::commands::open_project(&state);
    import_into(&state, project, &vault, &passphrase, check_only == Some(true))
}

/// What an import brought: how many logins, and the id each was exported
/// under mapped to the id it has here, so the project's references to
/// them — its own logins, its devices', its rules — can follow.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedVault {
    pub count: usize,
    pub ids: std::collections::BTreeMap<String, String>,
}

fn import_into(state: &AppState, project: Option<String>, vault: &serde_json::Value, passphrase: &str, check_only: bool) -> CmdResult<ImportedVault> {
    let guard = state.vault_key.lock().map_err(db_err)?;
    let local = guard.as_ref().ok_or_else(|| vault::VaultError::Locked.to_string())?;

    let bytes = |v: &serde_json::Value| -> Option<Vec<u8>> {
        v.as_array()?
            .iter()
            .map(|n| n.as_u64().and_then(|x| u8::try_from(x).ok()))
            .collect()
    };

    let header = vault::VaultHeader {
        salt: bytes(&vault["salt"]).ok_or("That package's credentials are damaged.")?,
        verifier: bytes(&vault["verifier"]).ok_or("That package's credentials are damaged.")?,
    };
    // Fails here, before anything is written, if the passphrase is wrong.
    let source = vault::unlock(passphrase, &header).map_err(|e| e.to_string())?;

    let items = vault["credentials"]
        .as_array()
        .ok_or("That package has no credentials to import.")?;

    // Every one opened and re-sealed before anything is written.
    let mut resealed = Vec::with_capacity(items.len());
    let mut ids = std::collections::BTreeMap::new();
    for item in items {
        let reseal = |nonce: &serde_json::Value, cipher: &serde_json::Value| -> CmdResult<Option<(Vec<u8>, Vec<u8>)>> {
            let (Some(nonce), Some(ciphertext)) = (bytes(nonce), bytes(cipher)) else {
                return Ok(None);
            };
            let plain = vault::open(&source, &vault::SealedSecret { nonce, ciphertext })
                .map_err(|e| e.to_string())?;
            let sealed = vault::seal(local, &plain).map_err(|e| e.to_string())?;
            Ok(Some((sealed.nonce, sealed.ciphertext)))
        };

        let Some(secret) = reseal(&item["secretNonce"], &item["secretCipher"])? else {
            continue;
        };
        let extra = reseal(&item["extraNonce"], &item["extraCipher"])?;

        let text = |k: &str| item[k].as_str().unwrap_or_default().to_string();
        let stored = db::StoredCredential {
            // A fresh id: an import must not overwrite a local credential that
            // happens to share one, which two vaults seeded from the same
            // export would.
            id: uuid::Uuid::new_v4().to_string(),
            label: text("label"),
            kind: text("kind"),
            username: text("username"),
            secret,
            extra,
            detail: text("detail"),
        };
        if let Some(was) = item["id"].as_str().filter(|x| !x.is_empty()) {
            ids.insert(was.to_string(), stored.id.clone());
        }
        resealed.push(stored);
    }
    if check_only {
        return Ok(ImportedVault { count: resealed.len(), ids: Default::default() });
    }

    let project = project.ok_or(NO_PROJECT_OPEN)?;
    let conn = state.db.lock().map_err(db_err)?;
    for stored in &resealed {
        db::save_credential(&conn, &project, stored, now_ms()).map_err(db_err)?;
    }
    Ok(ImportedVault { count: resealed.len(), ids })
}

/// Rebuilds SSH credentials from the vault, for use inside this process.
///
/// Deliberately not a command. It returns plaintext, so it is callable from
/// Rust and unreachable from the interface — the whole arrangement rests on
/// that distinction.
pub fn ssh_credentials(state: &AppState, id: &str) -> CmdResult<Credentials> {
    let guard = state.vault_key.lock().map_err(db_err)?;
    let key = guard.as_ref().ok_or_else(|| vault::VaultError::Locked.to_string())?;
    let stored = own_login(state, id)?;

    let password = open_secret(key, &stored.secret)?;
    let enable_password = match &stored.extra {
        None => None,
        Some(e) => Some(Secret::new(open_secret(key, e)?)),
    };
    Ok(Credentials {
        username: stored.username,
        password: Secret::new(password),
        enable_password,
    })
}

/// A saved SFTP login (kind `sftp`): the server a device is told to send
/// its configuration to under a backup over SNMP, and that Corelens then
/// reads the file from. A kind of its own so that it is never offered to a
/// device as an SSH login. Not a command, for the same reason as
/// `ssh_credentials`.
pub fn sftp_credentials(state: &AppState, id: &str) -> CmdResult<(String, Secret)> {
    let guard = state.vault_key.lock().map_err(db_err)?;
    let key = guard.as_ref().ok_or_else(|| vault::VaultError::Locked.to_string())?;
    let stored = own_login(state, id)?;
    if stored.kind != "sftp" {
        return Err("That saved credential is not an SFTP login.".into());
    }
    let password = open_secret(key, &stored.secret)?;
    Ok((stored.username, Secret::new(password)))
}

/// A saved API login (kind `api`), for the REST collectors. Not a
/// command, for the same reason as `ssh_credentials`.
pub fn api_credentials(state: &AppState, id: &str) -> CmdResult<corelens_collect::api::ApiLogin> {
    let guard = state.vault_key.lock().map_err(db_err)?;
    let key = guard.as_ref().ok_or_else(|| vault::VaultError::Locked.to_string())?;
    let stored = own_login(state, id)?;
    if stored.kind != "api" {
        return Err("That saved credential is not an API login.".into());
    }
    // An API login's `detail` is its HTTPS port; blank is 443.
    let port = stored.detail.trim().parse::<u16>().ok().filter(|p| *p != 0);
    Ok(corelens_collect::api::ApiLogin { username: stored.username, secret: open_secret(key, &stored.secret)?, port })
}

/// Notes that a saved credential was offered to `target`, in the local
/// log only. Best effort: a log that could not be written never stops the job
/// the credential was opened for.
pub fn note_use(state: &AppState, credential_id: &str, purpose: &str, target: &str) {
    if let Ok(conn) = state.db.lock() {
        // In the open project's log; with none open there is no log to write to.
        if let Some(project) = crate::commands::open_project(state) {
            let _ = db::record_credential_use(&conn, &project, credential_id, purpose, target, db::now_ms());
        }
    }
}

/// Where saved credentials were used, newest first. Read on this
/// machine and never sent anywhere.
#[tauri::command(async)]
pub fn list_credential_use(state: State<'_, AppState>, credential_id: Option<String>, limit: Option<i64>) -> CmdResult<Vec<db::CredentialUseRow>> {
    let Some(project) = crate::commands::open_project(&state) else { return Ok(Vec::new()) };
    let conn = state.db.lock().map_err(db_err)?;
    db::list_credential_use(&conn, &project, credential_id.as_deref(), limit.unwrap_or(500).clamp(1, 5_000)).map_err(db_err)
}

#[tauri::command(async)]
pub fn clear_credential_use(state: State<'_, AppState>) -> CmdResult<usize> {
    let Some(project) = crate::commands::open_project(&state) else { return Ok(0) };
    let conn = state.db.lock().map_err(db_err)?;
    db::clear_credential_use(&conn, &project).map_err(db_err)
}

/// Every SSH login the open project has, in the order a run tries them after its first login:
/// the ids the page sent, in their order (the project's default and its
/// other logins), then every other one the project keeps, by label.
/// The login the run starts with is never repeated, and with no project open
/// nothing is added.
pub fn project_login_order(state: &AppState, sent: &[String], first: Option<&str>) -> Vec<String> {
    let kept: Vec<String> = match crate::commands::open_project(state) {
        Some(p) => match state.db.lock() {
            Ok(conn) => db::list_credentials(&conn, &p).map(|rows| rows.into_iter().filter(|(_, _, kind, ..)| kind == "ssh").map(|(id, ..)| id).collect()).unwrap_or_default(),
            Err(_) => Vec::new(),
        },
        None => Vec::new(),
    };
    login_order(sent, &kept, first)
}

/// The login a device job starts with, then every other SSH login the open
/// project keeps, each opened and paired with its id so the one a device
/// accepts can be recorded. A kept login that has gone, or will not open, is
/// one fewer to try; the chosen one must open.
pub fn ssh_login_chain(state: &AppState, first: &str) -> CmdResult<Vec<(String, Credentials)>> {
    let mut chain = vec![(first.to_string(), ssh_credentials(state, first)?)];
    for id in project_login_order(state, &[], Some(first)) {
        if !credential_exists(state, &id) {
            continue;
        }
        if let Ok(c) = ssh_credentials(state, &id) {
            chain.push((id, c));
        }
    }
    Ok(chain)
}

/// The pure half of `project_login_order`.
pub fn login_order(sent: &[String], kept: &[String], first: Option<&str>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in sent.iter().chain(kept.iter()) {
        let id = id.trim();
        if id.is_empty() || Some(id) == first.map(str::trim) || out.iter().any(|o| o == id) {
            continue;
        }
        out.push(id.to_string());
    }
    out
}

/// Whether the open project still has this login.
///
/// A project's document stores login *ids*. An id can go stale — the login
/// was deleted, the project is a copy of another (a copy gets no logins), or
/// it was opened on a machine that never had it — and a stale id must never
/// be fatal to anything.
pub fn credential_exists(state: &AppState, id: &str) -> bool {
    own_login(state, id).is_ok()
}

/// What kind a saved credential is — `ssh` or `snmp` — without opening it.
pub fn credential_kind(state: &AppState, id: &str) -> CmdResult<String> {
    Ok(own_login(state, id)?.kind)
}

/// Rebuilds SNMP credentials from the vault. Also not a command, for the same
/// reason.
pub fn snmp_credentials(state: &AppState, id: &str) -> CmdResult<SnmpAuth> {
    let guard = state.vault_key.lock().map_err(db_err)?;
    let key = guard.as_ref().ok_or_else(|| vault::VaultError::Locked.to_string())?;
    let stored = own_login(state, id)?;

    let secret = open_secret(key, &stored.secret)?;
    // "sha|aes 256" — algorithm words, which are not secret and so are stored
    // in clear beside the ciphertext.
    let (auth_word, priv_word) = stored.detail.split_once('|').unwrap_or(("sha", ""));

    if stored.username.is_empty() {
        return Ok(SnmpAuth::V2c { community: secret });
    }
    Ok(SnmpAuth::V3 {
        username: stored.username,
        auth_protocol: AuthKind::parse(auth_word).unwrap_or(AuthKind::Sha1),
        auth_password: secret,
        privacy: PrivKind::parse(priv_word),
        privacy_password: match &stored.extra {
            None => String::new(),
            Some(e) => open_secret(key, e)?,
        },
    })
}

pub fn open_secret(key: &VaultKey, parts: &(Vec<u8>, Vec<u8>)) -> CmdResult<String> {
    vault::open(
        key,
        &SealedSecret {
            nonce: parts.0.clone(),
            ciphertext: parts.1.clone(),
        },
    )
    .map_err(|e| e.to_string())
}

/// The credentials a package carries: those of `wanted` that exist, in the
/// vault's order. `None` means every one, which only a caller that said so
/// gets; an empty list is an empty list.
pub fn chosen(all: &[String], wanted: Option<&[String]>) -> Vec<String> {
    match wanted {
        None => all.to_vec(),
        Some(ids) => all.iter().filter(|id| ids.iter().any(|w| w == *id)).cloned().collect(),
    }
}

#[cfg(test)]
mod import_tests {
    use super::{import_into, NO_PROJECT_OPEN};
    use crate::db;

    /// A package as `export_vault` writes it, from the fixture's vault.
    fn package(state: &crate::commands::AppState) -> serde_json::Value {
        let conn = state.db.lock().unwrap();
        let (salt, verifier) = db::vault_header(&conn).unwrap().unwrap();
        let c = db::credential(&conn, "p1", "cred-1").unwrap().unwrap();
        serde_json::json!({
            "salt": salt, "verifier": verifier,
            "credentials": [{ "id": c.id, "label": c.label, "kind": c.kind, "username": c.username, "detail": c.detail,
                "secretNonce": c.secret.0, "secretCipher": c.secret.1 }],
        })
    }
    fn count(state: &crate::commands::AppState, project: &str) -> usize {
        db::list_credentials(&state.db.lock().unwrap(), project).unwrap().len()
    }

    /// The start screen imports a package's logins before the project they
    /// belong to exists, so it first checks the passphrase with nothing
    /// open, then imports into the project it has just made.
    #[test]
    fn a_check_needs_no_project_and_writes_nothing_then_the_import_goes_into_the_open_one() {
        let state = crate::mcp::roundtrip::app_state_as("SW1", true);
        let pkg = package(&state);

        let wrong = import_into(&state, None, &pkg, "not the exporting passphrase", true);
        assert!(wrong.is_err(), "a wrong passphrase is refused by the check");
        assert_eq!(import_into(&state, None, &pkg, "fixture vault passphrase", true).map(|x| x.count), Ok(1));
        assert_eq!(count(&state, "p1") + count(&state, "fresh"), 1, "a check writes nothing");
        assert_eq!(import_into(&state, None, &pkg, "fixture vault passphrase", false), Err(NO_PROJECT_OPEN.to_string()));

        let got = import_into(&state, Some("fresh".into()), &pkg, "fixture vault passphrase", false).unwrap();
        assert_eq!(got.count, 1);
        assert_eq!(count(&state, "fresh"), 1, "the login is the newly opened project's");
        // Under a fresh id, and the answer says which: the project's
        // references to `cred-1` are pointed at it.
        let now = got.ids.get("cred-1").expect("the exported id is mapped");
        assert_ne!(now, "cred-1");
        assert!(db::credential(&state.db.lock().unwrap(), "fresh", now).unwrap().is_some());
        assert_eq!(count(&state, "p1"), 1, "and no other project's");
    }
}

#[cfg(test)]
mod chosen_tests {
    use super::chosen;

    /// A project's package carries the credentials it refers to and no
    /// other; one it names that the vault no longer holds is simply absent.
    #[test]
    fn a_package_carries_the_credentials_its_project_refers_to_only() {
        let all: Vec<String> = ["cred-a", "cred-b", "cred-c"].iter().map(|s| s.to_string()).collect();
        let wanted: Vec<String> = ["cred-c", "cred-a", "cred-gone"].iter().map(|s| s.to_string()).collect();
        assert_eq!(chosen(&all, Some(&wanted)), ["cred-a", "cred-c"]);
        assert!(chosen(&all, Some(&[])).is_empty(), "a project with no logins exports none");
        assert_eq!(chosen(&all, None), all, "only a caller that asked for everything gets everything");
    }
}

#[cfg(test)]
mod tests {

    /// Every login the project keeps is tried, not just its default
    /// and the ones listed after it; the chosen first one is not repeated.
    #[test]
    fn every_login_the_project_keeps_follows_the_ones_sent() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(super::login_order(&s(&["b", "c"]), &s(&["a", "b", "c", "d", "e"]), Some("a")), s(&["b", "c", "d", "e"]));
        assert_eq!(super::login_order(&s(&[]), &s(&["a", "d"]), None), s(&["a", "d"]));
        assert_eq!(super::login_order(&s(&["x", "x", " "]), &s(&[]), Some("y")), s(&["x"]));
    }

    /// The commands of this file, each as (name, return type).
    fn commands() -> Vec<(String, String)> {
        let source = include_str!("vault_commands.rs");
        let source = source.split("#[cfg(test)]").next().unwrap();
        source
            .split("#[tauri::command")
            .skip(1)
            .map(|block| {
                let signature: String = block.chars().take(600).collect();
                let name = signature.split("pub fn ").nth(1).and_then(|s| s.split('(').next()).unwrap_or("?").to_string();
                let returns = signature.split("->").nth(1).and_then(|s| s.split('{').next()).unwrap_or("").to_string();
                (name, returns)
            })
            .collect()
    }

    /// No command hands a stored secret to the interface, checked against the
    /// source rather than by inspection.
    ///
    /// A future edit that quietly returned plaintext from `list_credentials`
    /// or `vault_status` would look perfectly reasonable in review. This
    /// fails on it — and on a command written to show a secret on purpose,
    /// which is the thing that must not come back.
    /// The vault before the database, wherever both are held. Some
    /// functions take the vault and then the database (to save a login, to
    /// open one); one that took them the other way round could meet one of
    /// those half-way, each holding what the other wants, and the app would
    /// stop answering. Read from the source: a `state.db.lock()` still in
    /// scope when `vault_key.lock()` is reached is the fault.
    #[test]
    fn the_vault_is_locked_before_the_database_wherever_both_are_held() {
        let source = include_str!("vault_commands.rs");
        // Everything above the tests; this function's own text names both.
        let source = source.split("#[cfg(test)]").next().unwrap_or(source);
        let mut offenders = Vec::new();
        let mut functions = 0;
        for body in source.split("\nfn ").chain(source.split("\npub fn ").skip(1)) {
            let name: String = body.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
            // One function: up to the brace that closes it at the margin.
            let body = body.split("\n}\n").next().unwrap_or(body);
            functions += 1;
            let bytes = body.as_bytes();
            let (mut depth, mut held_at): (i32, Option<i32>) = (0, None);
            let mut i = 0;
            while i < bytes.len() {
                match bytes[i] {
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if held_at.is_some_and(|d| depth < d) {
                            held_at = None;
                        }
                    }
                    _ => {}
                }
                if bytes[i..].starts_with(b"state.db.lock()") && held_at.is_none() {
                    held_at = Some(depth);
                }
                if bytes[i..].starts_with(b"vault_key.lock()") && held_at.is_some() {
                    offenders.push(name.clone());
                    break;
                }
                i += 1;
            }
        }
        assert!(functions > 20, "the functions were not found");
        assert!(offenders.is_empty(), "the database is held while the vault is locked in: {offenders:?}");
    }

    #[test]
    fn no_command_returns_a_secret() {
        let commands = commands();
        // The check once split on an attribute spelling no command used, saw
        // no commands, and passed whatever they returned.
        assert!(commands.len() >= 12, "the commands were not found: {commands:?}");
        assert!(commands.iter().any(|(n, _)| n == "list_credentials") && commands.iter().any(|(n, _)| n == "save_credential"));

        let mut offenders = Vec::new();
        for (name, returns) in &commands {
            for forbidden in ["Credentials", "SnmpAuth", "VaultKey", "SealedSecret", "StoredCredential", "Revealed", "Secret", "ApiLogin"] {
                if returns.contains(forbidden) {
                    offenders.push(format!("{name} returns {forbidden}"));
                }
            }
            for word in ["reveal", "show_secret", "read_secret", "plaintext"] {
                if name.contains(word) {
                    offenders.push(format!("{name} is named for reading a secret"));
                }
            }
        }
        assert!(offenders.is_empty(), "a command returns something secret: {offenders:?}");
    }

    /// What the interface is told about a login has no field a secret could
    /// travel in.
    #[test]
    fn what_a_listing_carries_has_no_secret_in_it() {
        let source = include_str!("vault_commands.rs");
        let code = source.split("#[cfg(test)]").next().unwrap();
        let at = code.find("pub struct CredentialSummary").expect("the listing's shape");
        let shape = &code[at..at + code[at..].find("\n}").unwrap()];
        for field in ["secret:", "password", "community", "cipher", "nonce"] {
            assert!(!shape.contains(&format!("pub {field}")), "CredentialSummary has a field `{field}`");
        }
    }

    /// Every command that lists, saves, opens, deletes, exports or imports a
    /// login asks which project is open.
    #[test]
    fn every_login_command_is_scoped_to_the_open_project() {
        let source = include_str!("vault_commands.rs");
        let code = source.split("#[cfg(test)]").next().unwrap();
        for name in ["save_credential", "list_credentials", "delete_credential", "export_vault", "import_vault", "list_credential_use", "clear_credential_use"] {
            let at = code.find(&format!("pub fn {name}(")).unwrap_or_else(|| panic!("{name} is missing"));
            let body = &code[at..at + code[at..].find("\n}\n").unwrap()];
            assert!(body.contains("open_project("), "{name} does not ask which project is open");
        }
        assert!(!code.contains("fn assign_credential"), "a login is not handed from one project to another");
    }

    #[test]
    fn the_functions_that_do_return_secrets_are_not_commands() {
        // ssh_credentials and snmp_credentials exist and hand back plaintext;
        // the point is that they are plain Rust functions.
        let source = include_str!("vault_commands.rs");
        for name in ["fn ssh_credentials", "fn snmp_credentials", "fn sftp_credentials", "fn api_credentials", "fn own_login", "fn open_secret"] {
            let at = source.find(name).expect("function missing");
            let before = &source[at.saturating_sub(200)..at];
            assert!(
                !before.contains("#[tauri::command"),
                "{name} has become reachable from the interface"
            );
        }
    }
}
