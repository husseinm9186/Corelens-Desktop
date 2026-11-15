//! A device that offers only `hmac-sha1-96`.
//!
//! Older switches are still found locked to that one MAC, and a client that
//! does not offer it gets no further than the key exchange: "No common Mac
//! algorithm". This stands up the system's own OpenSSH server restricted to
//! it and points the real client at that.
//!
//! The ciphers are restricted too, and that is the point of the test rather
//! than a detail: with an AEAD cipher (chacha20-poly1305, AES-GCM) the cipher
//! carries its own integrity and no MAC is negotiated at all, so the
//! handshake succeeds whether the client knows the MAC or not. Only a CTR
//! cipher makes the two sides agree on one.
//!
//! Nobody can log in to an sshd that is not running as root, so the proof of
//! success is the *refusal*: `AuthFailed` means the key exchange agreed on
//! the MAC and the authentication packets — each one MAC-verified in both
//! directions — went there and back.
//!
//! Skipped, with a message, where no `sshd` is installed.

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use corelens_discover::hostkeys::HostKeyStore;
use corelens_discover::ssh::{Credentials, Device, Secret, SshError, SshOptions};

fn sshd_path() -> Option<PathBuf> {
    ["/usr/sbin/sshd", "/usr/bin/sshd", "/usr/local/sbin/sshd", "/opt/homebrew/sbin/sshd"]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.exists())
}

struct Server {
    child: Child,
    dir: PathBuf,
    port: u16,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// An sshd on a loopback port with a throwaway host key, offering the given
/// ciphers and MACs and nothing else. `None` when it cannot be started here.
fn start(sshd: &Path, ciphers: &str, macs: &str) -> Option<Server> {
    let dir = std::env::temp_dir().join(format!("corelens-sshd-{}-{}", std::process::id(), macs.replace(['@', '.', ','], "-")));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).ok()?;
    let key = dir.join("host_key");
    let made = Command::new("ssh-keygen")
        .args(["-q", "-t", "ed25519", "-N", "", "-f"])
        .arg(&key)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()?;
    if !made.success() {
        return None;
    }
    let port = TcpListener::bind("127.0.0.1:0").ok()?.local_addr().ok()?.port();
    let config = dir.join("sshd_config");
    std::fs::write(
        &config,
        format!(
            "Port {port}\nListenAddress 127.0.0.1\nHostKey {}\nPidFile {}\nCiphers {ciphers}\nMACs {macs}\n\
             PasswordAuthentication yes\nKbdInteractiveAuthentication no\nUsePAM no\nStrictModes no\nLogLevel ERROR\n",
            key.display(),
            dir.join("pid").display(),
        ),
    )
    .ok()?;
    let child = Command::new(sshd)
        .arg("-D")
        .arg("-e")
        .arg("-f")
        .arg(&config)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let server = Server { child, dir, port };
    for _ in 0..50 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Some(server);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

fn options(port: u16) -> SshOptions {
    SshOptions {
        port,
        connect_timeout: Duration::from_secs(10),
        auth_timeout: Duration::from_secs(20),
        command_timeout: Duration::from_secs(10),
        login_transcript: None,
        support_capture: None,
        max_output_bytes: corelens_discover::ssh::DEFAULT_MAX_OUTPUT_BYTES,
    }
}

async fn connect(port: u16) -> Result<(), SshError> {
    let credentials = Credentials {
        username: "nobody-here".into(),
        password: Secret::new("not-a-real-password"),
        enable_password: None,
    };
    let store = Arc::new(std::sync::Mutex::new(HostKeyStore::new()));
    Device::connect("127.0.0.1", &credentials, options(port), store, None).await.map(|_| ())
}

#[tokio::test]
async fn a_server_offering_only_hmac_sha1_96_is_spoken_to() {
    let Some(sshd) = sshd_path() else {
        eprintln!("skipped: no sshd on this machine");
        return;
    };
    let Some(server) = start(&sshd, "aes128-ctr,aes256-ctr", "hmac-sha1-96") else {
        eprintln!("skipped: sshd would not start with CTR ciphers and hmac-sha1-96 (this build may not have them)");
        return;
    };
    match connect(server.port).await {
        // The handshake agreed and the refusal came back through the MAC.
        Err(SshError::AuthFailed { .. }) => {}
        Err(other) => panic!("the handshake did not complete: {other}"),
        Ok(()) => panic!("nobody should be able to log in to this server"),
    }
}

/// The same server with a MAC the client has always known: the harness
/// itself works, so a failure above is the MAC and nothing else.
#[tokio::test]
async fn the_same_server_with_a_mac_already_known_is_spoken_to() {
    let Some(sshd) = sshd_path() else {
        eprintln!("skipped: no sshd on this machine");
        return;
    };
    let Some(server) = start(&sshd, "aes128-ctr,aes256-ctr", "hmac-sha2-256") else {
        eprintln!("skipped: sshd would not start");
        return;
    };
    assert!(matches!(connect(server.port).await, Err(SshError::AuthFailed { .. })));
}
