//! A serial console: the cable into a device's console port, as a session.
//!
//! The other half of being *at* a device. A switch that has no address yet,
//! or has lost its configuration, or is sitting in its boot loader, is
//! reached through its console port and nothing else — so the terminal that
//! holds the SSH sessions holds this one beside them.
//!
//! Three things are here:
//!
//! - **Which port.** A laptop lists a dozen serial ports and the console
//!   cable is one of them. [`ports`] lists what the machine has and
//!   [`rank`] says which are a USB serial adapter — which is what a console
//!   cable is, built into the cable or into the device's own USB console
//!   socket. [`chosen`] names the port when there is exactly one such, so the
//!   person at the keyboard need not know what the system called it.
//! - **The line.** [`Settings`]: 9600 8N1 with no flow control unless told
//!   otherwise, which is what nearly every network device's console speaks
//!   out of the box.
//! - **The session.** [`Console`] reads and writes raw bytes and knows
//!   nothing about prompts, exactly as `ssh::Shell` does. Nothing is sent
//!   that was not handed to [`Console::send`] — no wake-up carriage return,
//!   no probing of the speed: on a console a stray byte can interrupt a
//!   device that is booting. A break is sent only when asked for.
//!
//! The table of adapter makers is from the public USB vendor-id
//! assignments, not from a capture. Opening and reading are tested here
//! against a pseudo-terminal pair; **no part of this has met a real console
//! cable**, and [`verified_against_hardware`] says so.
use std::io::{Read as _, Write as _};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

/// Whether this has been run against a real cable and a real device.
pub fn verified_against_hardware() -> bool {
    false
}

/// What kind of serial port the system says this is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PortKind {
    /// A USB serial adapter: a console cable, or a device's USB console.
    Usb,
    /// A serial port over Bluetooth. Never a console cable.
    Bluetooth,
    /// A port on the machine's own board or a card in it.
    BuiltIn,
    /// The system does not say.
    Unknown,
}

/// One serial port, as the system reports it, before any judgement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawPort {
    pub name: String,
    pub kind: PortKind,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
}

/// One serial port the terminal can offer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    /// What it is opened by: `COM3`, `/dev/ttyUSB0`, `/dev/cu.usbserial-…`.
    pub name: String,
    pub kind: PortKind,
    /// What to call it beside its name: the adapter's product and maker.
    pub description: String,
    /// A USB serial adapter, so in all likelihood the console cable.
    pub likely_console: bool,
}

/// Makers of the chips console cables are built on, and of the devices
/// that carry a USB console socket of their own. From the public USB
/// vendor-id assignments.
fn maker(vid: u16) -> Option<&'static str> {
    Some(match vid {
        0x0403 => "FTDI",
        0x067b => "Prolific",
        0x10c4 => "Silicon Labs",
        0x1a86 => "WCH",
        0x05a6 => "Cisco",
        0x04e2 => "Exar",
        0x0557 => "ATEN",
        0x04b4 => "Cypress",
        0x2341 => "Arduino",
        _ => return None,
    })
}

/// On macOS every serial device appears twice, as `/dev/tty.x` (which waits
/// for carrier before it opens, and a console cable raises none) and
/// `/dev/cu.x` (which does not). Only the second is of any use here.
fn waits_for_carrier(name: &str) -> bool {
    name.starts_with("/dev/tty.")
}

/// The ports worth offering, the likely console cable first.
///
/// A USB serial adapter is likely; nothing else is. The sixteen or
/// thirty-two `ttyS` ports a Linux kernel lists whether or not there is
/// anything behind them, a laptop's Bluetooth ports and a modem are all
/// listed — somebody may really have a console on a built-in port — but
/// none is ever picked for them.
pub fn rank(raw: Vec<RawPort>) -> Vec<PortInfo> {
    let mut out: Vec<PortInfo> = raw
        .into_iter()
        .filter(|p| !waits_for_carrier(&p.name))
        .map(|p| {
            let named = [p.product.as_deref(), p.manufacturer.as_deref()]
                .into_iter()
                .flatten()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>();
            let description = match p.kind {
                PortKind::Usb if !named.is_empty() => {
                    // A product that already names its maker is not said twice.
                    let product = named[0];
                    match named.get(1) {
                        Some(m) if !product.to_lowercase().contains(&m.to_lowercase()) => {
                            format!("{product} ({m})")
                        }
                        _ => product.to_string(),
                    }
                }
                PortKind::Usb => match p.vid.and_then(maker) {
                    Some(m) => format!("USB serial adapter ({m})"),
                    None => "USB serial adapter".to_string(),
                },
                PortKind::Bluetooth => "Bluetooth".to_string(),
                PortKind::BuiltIn => "Built-in serial port".to_string(),
                PortKind::Unknown => "Serial port".to_string(),
            };
            PortInfo {
                likely_console: p.kind == PortKind::Usb,
                name: p.name,
                kind: p.kind,
                description,
            }
        })
        .collect();
    // Likely first; within each, by name the way a person counts: COM3
    // before COM10.
    out.sort_by(|a, b| {
        b.likely_console
            .cmp(&a.likely_console)
            .then_with(|| natural(&a.name).cmp(&natural(&b.name)))
    });
    out
}

/// A name split so its trailing number sorts as a number.
fn natural(name: &str) -> (String, u64) {
    let digits = name.chars().rev().take_while(char::is_ascii_digit).count();
    let (stem, number) = name.split_at(name.len() - digits);
    (stem.to_lowercase(), number.parse().unwrap_or(0))
}

/// The port to open without asking: the likely console, when there is
/// exactly one. Two cables plugged in, or none, is a question for whoever
/// is at the keyboard.
pub fn chosen(ports: &[PortInfo]) -> Option<&PortInfo> {
    let mut likely = ports.iter().filter(|p| p.likely_console);
    match (likely.next(), likely.next()) {
        (Some(only), None) => Some(only),
        _ => None,
    }
}

/// Every serial port this machine has, the likely console first.
pub fn ports() -> Result<Vec<PortInfo>, ConsoleError> {
    let found = serialport::available_ports().map_err(|e| ConsoleError::List(e.to_string()))?;
    Ok(rank(
        found
            .into_iter()
            .map(|p| {
                let (kind, usb) = match p.port_type {
                    serialport::SerialPortType::UsbPort(u) => (PortKind::Usb, Some(u)),
                    serialport::SerialPortType::BluetoothPort => (PortKind::Bluetooth, None),
                    serialport::SerialPortType::PciPort => (PortKind::BuiltIn, None),
                    serialport::SerialPortType::Unknown => (PortKind::Unknown, None),
                };
                RawPort {
                    name: p.port_name,
                    kind,
                    vid: usb.as_ref().map(|u| u.vid),
                    pid: usb.as_ref().map(|u| u.pid),
                    manufacturer: usb.as_ref().and_then(|u| u.manufacturer.clone()),
                    product: usb.as_ref().and_then(|u| u.product.clone()),
                }
            })
            .collect(),
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Parity {
    #[default]
    None,
    Odd,
    Even,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum FlowControl {
    #[default]
    None,
    /// XON/XOFF.
    Software,
    /// RTS/CTS.
    Hardware,
}

/// The speeds a console is ever set to. Anything else is a typing mistake.
pub const SPEEDS: [u32; 8] = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

/// How the line is spoken.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub baud: u32,
    pub data_bits: u8,
    pub parity: Parity,
    pub stop_bits: u8,
    pub flow: FlowControl,
}

impl Default for Settings {
    /// 9600 8N1, no flow control: what a network device's console speaks
    /// until somebody configures it otherwise.
    fn default() -> Self {
        Self {
            baud: 9600,
            data_bits: 8,
            parity: Parity::None,
            stop_bits: 1,
            flow: FlowControl::None,
        }
    }
}

impl Settings {
    /// The usual shorthand: `9600 8N1`.
    pub fn describe(&self) -> String {
        let parity = match self.parity {
            Parity::None => 'N',
            Parity::Odd => 'O',
            Parity::Even => 'E',
        };
        format!("{} {}{}{}", self.baud, self.data_bits, parity, self.stop_bits)
    }

    /// Refuses what no console speaks, before a port is touched.
    pub fn check(&self) -> Result<(), ConsoleError> {
        if !SPEEDS.contains(&self.baud) {
            return Err(ConsoleError::Settings(format!(
                "{} is not a console speed. Choose one of {}.",
                self.baud,
                SPEEDS.map(|s| s.to_string()).join(", ")
            )));
        }
        if !(5..=8).contains(&self.data_bits) {
            return Err(ConsoleError::Settings(format!(
                "{} data bits is not possible; 5 to 8.",
                self.data_bits
            )));
        }
        if !(1..=2).contains(&self.stop_bits) {
            return Err(ConsoleError::Settings(format!(
                "{} stop bits is not possible; 1 or 2.",
                self.stop_bits
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConsoleError {
    #[error("The serial ports could not be listed: {0}")]
    List(String),
    #[error("{0}")]
    Settings(String),
    /// With what to do about it where that is known.
    #[error("{port} could not be opened: {why}")]
    Open { port: String, why: String },
    #[error("The console on {port} stopped answering: {why}")]
    Lost { port: String, why: String },
}

/// Why a port would not open, in terms of what to do next.
fn why_not(e: &serialport::Error) -> String {
    use serialport::ErrorKind;
    let text = e.to_string();
    let lower = text.to_lowercase();
    match e.kind() {
        ErrorKind::NoDevice => {
            if lower.contains("busy") || lower.contains("denied") {
                // Windows reports a port another program holds this way.
                "another program has it open, or it was unplugged. Close the other terminal and try again.".to_string()
            } else {
                "it is not there any more. Was the cable unplugged?".to_string()
            }
        }
        ErrorKind::Io(std::io::ErrorKind::PermissionDenied) => {
            if cfg!(target_os = "linux") {
                "this account may not use serial ports. Add it to the dialout group (or uucp on some systems), then sign out and in again.".to_string()
            } else {
                "access was refused. Another program may have it open.".to_string()
            }
        }
        ErrorKind::Io(std::io::ErrorKind::NotFound) => {
            "it is not there any more. Was the cable unplugged?".to_string()
        }
        _ if lower.contains("busy") => {
            "another program has it open. Close the other terminal and try again.".to_string()
        }
        _ => text,
    }
}

/// How long a break is held. A quarter of a second is long enough for every
/// boot loader that listens for one and short of the half second some
/// devices take as a reset.
const BREAK: Duration = Duration::from_millis(250);

/// An open console.
pub struct Console {
    port_name: String,
    /// The writing half; the reading half is a clone owned by the thread.
    writer: Box<dyn serialport::SerialPort>,
    from_device: mpsc::Receiver<Result<Vec<u8>, String>>,
    stop: Arc<AtomicBool>,
}

impl Console {
    /// Opens the port at these settings. Sends nothing.
    pub fn open(port: &str, settings: &Settings) -> Result<Self, ConsoleError> {
        settings.check()?;
        let opened = serialport::new(port, settings.baud)
            .data_bits(match settings.data_bits {
                5 => serialport::DataBits::Five,
                6 => serialport::DataBits::Six,
                7 => serialport::DataBits::Seven,
                _ => serialport::DataBits::Eight,
            })
            .parity(match settings.parity {
                Parity::None => serialport::Parity::None,
                Parity::Odd => serialport::Parity::Odd,
                Parity::Even => serialport::Parity::Even,
            })
            .stop_bits(if settings.stop_bits == 2 {
                serialport::StopBits::Two
            } else {
                serialport::StopBits::One
            })
            .flow_control(match settings.flow {
                FlowControl::None => serialport::FlowControl::None,
                FlowControl::Software => serialport::FlowControl::Software,
                FlowControl::Hardware => serialport::FlowControl::Hardware,
            })
            .timeout(READ_WAIT)
            .open()
            .map_err(|e| ConsoleError::Open {
                port: port.to_string(),
                why: why_not(&e),
            })?;
        Self::over(port, opened)
    }

    /// A session over a port that is already open — a real one, or one end
    /// of a pseudo-terminal in a test.
    pub fn over(
        port_name: &str,
        mut port: Box<dyn serialport::SerialPort>,
    ) -> Result<Self, ConsoleError> {
        let failed = |e: serialport::Error| ConsoleError::Open {
            port: port_name.to_string(),
            why: e.to_string(),
        };
        port.set_timeout(READ_WAIT).map_err(failed)?;
        let mut reader = port.try_clone().map_err(failed)?;
        let (tx, from_device) = mpsc::channel::<Result<Vec<u8>, String>>(256);
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = Arc::clone(&stop);
        // A thread, not a task: a serial port blocks, and the wait is short
        // only so that closing the session is noticed.
        std::thread::Builder::new()
            .name("console-read".to_string())
            .spawn(move || {
                let mut buffer = [0u8; 4096];
                while !stopped.load(Ordering::Relaxed) {
                    match reader.read(&mut buffer) {
                        // Nothing was said in this wait. Not the end of
                        // anything: a console is silent for hours.
                        Ok(0) => std::thread::sleep(Duration::from_millis(20)),
                        Ok(n) => {
                            if tx.blocking_send(Ok(buffer[..n].to_vec())).is_err() {
                                return;
                            }
                        }
                        Err(e)
                            if matches!(
                                e.kind(),
                                std::io::ErrorKind::TimedOut
                                    | std::io::ErrorKind::WouldBlock
                                    | std::io::ErrorKind::Interrupted
                            ) => {}
                        // The cable came out, or the adapter went away.
                        Err(e) => {
                            let _ = tx.blocking_send(Err(e.to_string()));
                            return;
                        }
                    }
                }
            })
            .map_err(|e| ConsoleError::Open {
                port: port_name.to_string(),
                why: e.to_string(),
            })?;
        Ok(Self {
            port_name: port_name.to_string(),
            writer: port,
            from_device,
            stop,
        })
    }

    pub fn port(&self) -> &str {
        &self.port_name
    }

    /// The next bytes from the device. `Err` once, when the port is lost;
    /// `None` after that, or once the session is closed.
    pub async fn read(&mut self) -> Option<Result<Vec<u8>, ConsoleError>> {
        let got = self.from_device.recv().await?;
        Some(got.map_err(|why| ConsoleError::Lost {
            port: self.port_name.clone(),
            why,
        }))
    }

    /// Exactly these bytes, to the device.
    pub fn send(&mut self, bytes: &[u8]) -> Result<(), ConsoleError> {
        self.writer
            .write_all(bytes)
            .and_then(|()| self.writer.flush())
            .map_err(|e| self.lost(e.to_string()))
    }

    /// A break: the line held low for a quarter of a second. What a boot
    /// loader waits for, and how a password is recovered — so it is sent
    /// only when somebody asks for it.
    pub async fn send_break(&mut self) -> Result<(), ConsoleError> {
        self.writer
            .set_break()
            .map_err(|e| self.lost(e.to_string()))?;
        tokio::time::sleep(BREAK).await;
        self.writer
            .clear_break()
            .map_err(|e| self.lost(e.to_string()))
    }

    fn lost(&self, why: String) -> ConsoleError {
        ConsoleError::Lost {
            port: self.port_name.clone(),
            why,
        }
    }

    /// Lets go of the port, so another program — or this one again — can
    /// open it.
    pub fn close(self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl Drop for Console {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// How long one read waits before looking at whether to stop.
const READ_WAIT: Duration = Duration::from_millis(100);

#[cfg(test)]
mod tests {
    use super::*;

    fn usb(name: &str, vid: u16, product: Option<&str>, maker: Option<&str>) -> RawPort {
        RawPort {
            name: name.to_string(),
            kind: PortKind::Usb,
            vid: Some(vid),
            pid: Some(1),
            manufacturer: maker.map(str::to_string),
            product: product.map(str::to_string),
        }
    }

    fn plain(name: &str, kind: PortKind) -> RawPort {
        RawPort {
            name: name.to_string(),
            kind,
            vid: None,
            pid: None,
            manufacturer: None,
            product: None,
        }
    }

    #[test]
    fn the_one_usb_adapter_among_a_machines_ports_is_the_console() {
        // What a Linux laptop lists with one cable in: the kernel's own
        // placeholder ports, and the cable.
        let mut raw: Vec<RawPort> = (0..32)
            .map(|n| plain(&format!("/dev/ttyS{n}"), PortKind::Unknown))
            .collect();
        raw.push(usb(
            "/dev/ttyUSB0",
            0x0403,
            Some("FT232R USB UART"),
            Some("FTDI"),
        ));
        let ports = rank(raw);
        assert_eq!(ports[0].name, "/dev/ttyUSB0");
        assert!(ports[0].likely_console);
        assert_eq!(ports[0].description, "FT232R USB UART (FTDI)");
        assert_eq!(chosen(&ports).map(|p| p.name.as_str()), Some("/dev/ttyUSB0"));
        // The rest are still offered, in counting order, and none is likely.
        assert_eq!(ports.len(), 33);
        assert_eq!(ports[1].name, "/dev/ttyS0");
        assert_eq!(ports[3].name, "/dev/ttyS2");
        assert_eq!(ports[11].name, "/dev/ttyS10");
        assert!(ports[1..].iter().all(|p| !p.likely_console));
    }

    #[test]
    fn two_cables_or_none_is_a_question_not_a_guess() {
        let two = rank(vec![
            usb("COM10", 0x067b, None, None),
            usb("COM3", 0x10c4, None, None),
            plain("COM1", PortKind::BuiltIn),
        ]);
        assert_eq!(chosen(&two), None);
        // Both first, COM3 before COM10.
        assert_eq!(
            two.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            ["COM3", "COM10", "COM1"]
        );
        let none = rank(vec![
            plain("COM1", PortKind::BuiltIn),
            plain("COM4", PortKind::Bluetooth),
        ]);
        assert_eq!(chosen(&none), None);
        assert_eq!(none.len(), 2);
        assert_eq!(chosen(&[]), None);
    }

    #[test]
    fn a_bluetooth_port_is_never_taken_for_the_cable() {
        let ports = rank(vec![
            plain("/dev/cu.Bluetooth-Incoming-Port", PortKind::Bluetooth),
            plain("COM5", PortKind::Bluetooth),
        ]);
        assert!(ports.iter().all(|p| !p.likely_console));
        assert_eq!(ports[0].description, "Bluetooth");
    }

    #[test]
    fn a_mac_lists_each_cable_once_by_the_name_that_opens() {
        let ports = rank(vec![
            usb("/dev/tty.usbserial-0001", 0x10c4, None, None),
            usb("/dev/cu.usbserial-0001", 0x10c4, None, None),
        ]);
        assert_eq!(ports.len(), 1);
        assert_eq!(ports[0].name, "/dev/cu.usbserial-0001");
        assert_eq!(ports[0].description, "USB serial adapter (Silicon Labs)");
        assert_eq!(chosen(&ports).map(|p| p.name.as_str()), Some("/dev/cu.usbserial-0001"));
    }

    #[test]
    fn an_adapter_is_described_by_what_it_says_it_is() {
        let d = |p: RawPort| rank(vec![p])[0].description.clone();
        // A product that names its maker is not said twice.
        assert_eq!(
            d(usb("COM3", 0x05a6, Some("Cisco USB Console"), Some("Cisco"))),
            "Cisco USB Console"
        );
        assert_eq!(d(usb("COM3", 0x1a86, Some("  "), None)), "USB serial adapter (WCH)");
        assert_eq!(d(usb("COM3", 0xffff, None, None)), "USB serial adapter");
    }

    #[test]
    fn the_line_is_9600_8n1_unless_told_otherwise() {
        let s = Settings::default();
        assert_eq!(s.describe(), "9600 8N1");
        assert_eq!(s.flow, FlowControl::None);
        assert!(s.check().is_ok());
        let fast = Settings {
            baud: 115200,
            parity: Parity::Even,
            data_bits: 7,
            stop_bits: 2,
            ..s
        };
        assert_eq!(fast.describe(), "115200 7E2");
        assert!(fast.check().is_ok());
    }

    #[test]
    fn a_line_no_console_speaks_is_refused_before_a_port_is_touched() {
        let s = Settings::default();
        for bad in [
            Settings { baud: 9601, ..s },
            Settings { baud: 0, ..s },
            Settings { data_bits: 9, ..s },
            Settings { data_bits: 4, ..s },
            Settings { stop_bits: 0, ..s },
            Settings { stop_bits: 3, ..s },
        ] {
            assert!(matches!(bad.check(), Err(ConsoleError::Settings(_))), "{bad:?}");
            // And the port is never opened: one that does not exist would
            // otherwise say so instead.
            assert!(matches!(
                Console::open("/dev/there-is-no-such-port", &bad),
                Err(ConsoleError::Settings(_))
            ));
        }
    }

    #[test]
    fn a_port_that_is_not_there_says_so() {
        let Err(e) = Console::open("/dev/there-is-no-such-port", &Settings::default()) else {
            panic!("a port that does not exist opened");
        };
        let said = e.to_string();
        assert!(said.starts_with("/dev/there-is-no-such-port could not be opened: "), "{said}");
    }

    #[test]
    fn the_settings_the_window_sends_are_exactly_these_and_no_others() {
        let s: Settings = serde_json::from_str(
            r#"{"baud":115200,"dataBits":8,"parity":"none","stopBits":1,"flow":"hardware"}"#,
        )
        .expect("the settings as the window writes them");
        assert_eq!(s.baud, 115200);
        assert_eq!(s.flow, FlowControl::Hardware);
        assert!(serde_json::from_str::<Settings>(
            r#"{"baud":9600,"dataBits":8,"parity":"none","stopBits":1,"flow":"none","extra":1}"#
        )
        .is_err());
    }

    #[test]
    fn nothing_has_met_a_cable_yet_and_it_says_so() {
        assert!(!verified_against_hardware());
    }

    /// The session against a pseudo-terminal: one end is the console's
    /// port, the other stands in for the device.
    #[cfg(unix)]
    mod against_a_pseudo_terminal {
        use super::super::*;

        fn pair() -> (Console, serialport::TTYPort) {
            let (ours, mut theirs) = serialport::TTYPort::pair().expect("a pseudo-terminal pair");
            serialport::SerialPort::set_timeout(&mut theirs, Duration::from_millis(500))
                .expect("a timeout on the device's end");
            let console = Console::over("test-port", Box::new(ours)).expect("a console over it");
            (console, theirs)
        }

        async fn next(console: &mut Console) -> Vec<u8> {
            tokio::time::timeout(Duration::from_secs(5), console.read())
                .await
                .expect("the device's bytes within five seconds")
                .expect("an open session")
                .expect("no error")
        }

        #[tokio::test(flavor = "multi_thread")]
        async fn what_the_device_says_arrives_and_what_is_typed_reaches_it() {
            let (mut console, mut device) = pair();
            device.write_all(b"Switch>").expect("the device speaks");
            let mut heard = Vec::new();
            while heard.len() < 7 {
                heard.extend(next(&mut console).await);
            }
            assert_eq!(heard, b"Switch>");

            console.send(b"enable\r").expect("typed");
            let mut typed = [0u8; 7];
            device.read_exact(&mut typed).expect("the device hears it");
            assert_eq!(&typed, b"enable\r");
        }

        #[tokio::test(flavor = "multi_thread")]
        async fn opening_sends_the_device_nothing() {
            let (console, mut device) = pair();
            // Long enough for anything a session might say on its own.
            tokio::time::sleep(Duration::from_millis(400)).await;
            let mut one = [0u8; 1];
            let got = device.read(&mut one);
            assert!(
                matches!(got, Ok(0)) || got.is_err(),
                "the console wrote {one:?} without being asked"
            );
            console.close();
        }

        #[tokio::test(flavor = "multi_thread")]
        async fn bytes_arrive_as_they_were_sent_whatever_they_are() {
            let (mut console, mut device) = pair();
            // An escape sequence and a split multi-byte character: nothing
            // here may interpret, drop or reorder a byte.
            let said: Vec<u8> = b"\x1b[1;32mok\x1b[0m \xe2\x9c".to_vec();
            device.write_all(&said).expect("the device speaks");
            let mut heard = Vec::new();
            while heard.len() < said.len() {
                heard.extend(next(&mut console).await);
            }
            assert_eq!(heard, said);
        }

        #[tokio::test(flavor = "multi_thread")]
        async fn a_closed_session_reads_nothing_more() {
            let (mut console, _device) = pair();
            console.stop.store(true, Ordering::Relaxed);
            let ended = tokio::time::timeout(Duration::from_secs(5), console.read())
                .await
                .expect("the reader stops within five seconds");
            assert!(ended.is_none());
        }
    }
}
