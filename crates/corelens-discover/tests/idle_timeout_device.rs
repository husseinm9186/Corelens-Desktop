//! A device with its own idle timeout, against the terminal's keepalive.
//!
//! A switch's `exec-timeout` (and its equivalents on other platforms) counts
//! only what arrives in the session. SSH-level keepalives keep the connection
//! and any NAT in between alive, but the CLI still logs the session out. The
//! fake device here does exactly that: no input for `IDLE`, and it says so and
//! closes the channel, whatever keepalives it has answered.
//!
//! What is proved:
//! - the keepalive alone is logged out;
//! - the keepalive with the command line kept awake stays up;
//! - nothing is sent into a half-typed command, so that session is still
//!   logged out rather than having its line touched.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use russh::server::{self, Auth, Msg, Session};
use russh::{Channel, ChannelId};

use corelens_discover::awake::KeepAwake;
use corelens_discover::hostkeys::HostKeyStore;
use corelens_discover::ssh::{Credentials, Secret, Shell, SshOptions};

const IDLE: Duration = Duration::from_millis(1200);
const TICK: Duration = Duration::from_millis(300);
const RUN: Duration = Duration::from_millis(3500);

#[derive(Clone)]
struct IdleDevice {
    last_input: Arc<Mutex<Instant>>,
    /// Every byte the session received, to show what was and was not sent.
    received: Arc<Mutex<Vec<u8>>>,
}

impl server::Handler for IdleDevice {
    type Error = russh::Error;

    async fn auth_password(&mut self, _user: &str, _password: &str) -> Result<Auth, Self::Error> {
        Ok(Auth::Accept)
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn pty_request(
        &mut self,
        _channel: ChannelId,
        _term: &str,
        _cw: u32,
        _rh: u32,
        _pw: u32,
        _ph: u32,
        _modes: &[(russh::Pty, u32)],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        Ok(())
    }

    async fn shell_request(&mut self, channel: ChannelId, session: &mut Session) -> Result<(), Self::Error> {
        session.data(channel, b"\r\nLEAF-01#".to_vec())?;
        *self.last_input.lock().unwrap() = Instant::now();
        let handle = session.handle();
        let last = Arc::clone(&self.last_input);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(50)).await;
                let idle = last.lock().unwrap().elapsed();
                if idle >= IDLE {
                    let _ = handle.data(channel, b"\r\nInactive timeout reached, logging out.\r\n".to_vec()).await;
                    let _ = handle.eof(channel).await;
                    let _ = handle.close(channel).await;
                    return;
                }
            }
        });
        Ok(())
    }

    async fn data(&mut self, channel: ChannelId, data: &[u8], session: &mut Session) -> Result<(), Self::Error> {
        *self.last_input.lock().unwrap() = Instant::now();
        self.received.lock().unwrap().extend_from_slice(data);
        // Echo as a line editor does: a backspace rubs out, a return redraws
        // the prompt.
        let mut echo = Vec::new();
        for &b in data {
            match b {
                b'\r' => echo.extend_from_slice(b"\r\nLEAF-01#"),
                0x08 | 0x7f => echo.extend_from_slice(b"\x08 \x08"),
                _ => echo.push(b),
            }
        }
        session.data(channel, echo)?;
        Ok(())
    }
}

async fn start() -> (u16, Arc<Mutex<Vec<u8>>>) {
    let key = russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap();
    let config = Arc::new(server::Config {
        inactivity_timeout: Some(Duration::from_secs(30)),
        auth_rejection_time: Duration::from_millis(1),
        keys: vec![key],
        ..Default::default()
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let received = Arc::new(Mutex::new(Vec::new()));
    let device = IdleDevice { last_input: Arc::new(Mutex::new(Instant::now())), received: Arc::clone(&received) };
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let config = Arc::clone(&config);
            let handler = device.clone();
            tokio::spawn(async move {
                let _ = server::run_stream(config, stream, handler).await;
            });
        }
    });
    (port, received)
}

async fn open(port: u16) -> Shell {
    let credentials = Credentials { username: "admin".into(), password: Secret::new("not-a-real-password"), enable_password: None };
    let options = SshOptions {
        port,
        connect_timeout: Duration::from_secs(10),
        auth_timeout: Duration::from_secs(10),
        command_timeout: Duration::from_secs(10),
        login_transcript: None,
        support_capture: None,
        max_output_bytes: corelens_discover::ssh::DEFAULT_MAX_OUTPUT_BYTES,
    };
    let store = Arc::new(Mutex::new(HostKeyStore::new()));
    Shell::open("127.0.0.1", &credentials, options, store, 80, 24, None).await.expect("open a shell")
}

/// Runs the session the way the terminal does for `RUN`: output fed to the
/// watcher, a tick every `TICK`. Returns whether the device logged it out,
/// and everything it printed.
async fn run(mut shell: Shell, mut awake: KeepAwake, typed_first: Option<&[u8]>) -> (bool, String) {
    let mut seen = Vec::new();
    if let Some(bytes) = typed_first {
        shell.send(bytes).await.unwrap();
        awake.typed();
    }
    let mut ticker = tokio::time::interval(TICK);
    ticker.tick().await;
    let deadline = tokio::time::sleep(RUN);
    tokio::pin!(deadline);
    let closed = loop {
        tokio::select! {
            chunk = shell.read() => match chunk {
                Some(bytes) => { awake.saw(&bytes); seen.extend_from_slice(&bytes); }
                None => break true,
            },
            _ = ticker.tick() => {
                if shell.stay_awake(&mut awake).await.is_err() { break true; }
            }
            _ = &mut deadline => break false,
        }
    };
    (closed, String::from_utf8_lossy(&seen).into_owned())
}

#[tokio::test]
async fn the_keepalive_alone_is_logged_out_by_the_device() {
    let (port, received) = start().await;
    let shell = open(port).await;
    let (closed, seen) = run(shell, KeepAwake::new(false), None).await;
    assert!(closed && seen.contains("Inactive timeout"), "the device should log out an idle session: {seen:?}");
    assert!(received.lock().unwrap().is_empty(), "nothing was typed");
}

#[tokio::test]
async fn the_command_line_kept_awake_stays_up() {
    let (port, received) = start().await;
    let shell = open(port).await;
    let (closed, seen) = run(shell, KeepAwake::new(true), None).await;
    assert!(!closed, "the session was logged out: {seen:?}");
    let got = received.lock().unwrap().clone();
    assert!(!got.is_empty() && got.chunks(2).all(|c| c == b" \x08"), "only a space and a backspace, never a newline: {got:?}");
}

#[tokio::test]
async fn nothing_is_sent_into_a_half_typed_command() {
    let (port, received) = start().await;
    let shell = open(port).await;
    let (closed, seen) = run(shell, KeepAwake::new(true), Some(b"show run")).await;
    assert!(closed, "a half-typed line was nudged: {seen:?}");
    assert_eq!(received.lock().unwrap().as_slice(), b"show run", "the line was touched");
}
