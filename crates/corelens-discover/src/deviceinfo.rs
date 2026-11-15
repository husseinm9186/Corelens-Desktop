//! One device asked what it is, and nothing else.
//!
//! A crawl logs in to a device, reads what it is, then asks it who its
//! neighbours are and goes to them. Some networks may not be walked that
//! way. This is the part of the reading that names the box — its model, its
//! serials, its software, how long it has been up, the members of its stack —
//! asked of the one address somebody chose, with no question about any other
//! device and no address followed afterwards.
//!
//! **What is asked is a list, and the list is checked.** [`questions`] is
//! every command sent once the version has answered, and its test fails if a
//! neighbour, ARP, MAC-table, route or interface command is ever among them.
//! Nothing is written to the device: every command is a `show`, a `display`,
//! a `get` or a print.
//!
//! No reader here is new. The version, identity and stack parsers are the
//! ones a crawl uses, with whatever each says about having met hardware.

use crate::dialect::{dialect_for, Family};
use crate::ssh::Device;
use crate::stacking::StackInfo;

/// What one device said about itself.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// The name in the device's own prompt.
    pub hostname: String,
    /// The family its version text names, as a crawl would call it.
    pub family: String,
    pub model: Option<String>,
    /// Every chassis serial, in the order the device lists them.
    pub serials: Vec<String>,
    /// The software it runs: the version text's own first line.
    pub software: Option<String>,
    /// The chassis's base MAC, where the platform prints one.
    pub mac: Option<String>,
    pub uptime_seconds: Option<u64>,
    /// The members, where this is several boxes answering as one.
    pub stack: Option<StackInfo>,
    /// Every command that was sent, in order — shown to whoever asked.
    pub commands: Vec<String>,
    /// True where a reader that produced any of this has met no hardware.
    pub unverified: bool,
}

/// Every command sent after the version has answered, for the platform that
/// version names. The whole of what a device is asked beyond
/// [`crate::dialect::VERSION_COMMANDS`].
pub fn questions(version: &str) -> Vec<String> {
    let dialect = dialect_for(version);
    let mut asked: Vec<String> = Vec::new();
    if let Some(paging) = dialect.paging_off() {
        // `connect` has already tried these two.
        if paging != "terminal length 0" && paging != "no page" {
            asked.push(paging.to_string());
        }
    }
    asked.extend(dialect.identity_commands().iter().map(|c| c.to_string()));
    if crate::arubasw::is_arubaos_switch(version) {
        asked.push(ARUBA_SYSTEM.to_string());
    }
    if crate::fortios::rejected_command(version) {
        asked.push(FORTI_STATUS.to_string());
        asked.push(FORTI_PERFORMANCE.to_string());
    } else {
        asked.extend(dialect.stack_commands().iter().map(|c| c.to_string()));
    }
    asked
}

const ARUBA_SYSTEM: &str = "show system";
const FORTI_STATUS: &str = "get system status";
const FORTI_PERFORMANCE: &str = "get system performance status";

/// Asks `device` what it is. The session is left open for the caller to
/// close; a command that fails is an empty answer, not an error, because a
/// device that will not print its stack table has still said its serial.
pub async fn read(device: &mut Device) -> DeviceInfo {
    let hostname = device.hostname().to_string();
    let mut commands = Vec::new();
    let mut version = String::new();
    for command in crate::dialect::VERSION_COMMANDS {
        commands.push(command.to_string());
        let out = device.run(command).await.unwrap_or_default();
        if version.is_empty() {
            version = out.clone();
        }
        if crate::dialect::identifies(&out) {
            version = out;
            break;
        }
    }
    // A FIPS-CC FortiGate holds a banner open and reads the next command as
    // the answer to it; on a box with no banner this sends nothing.
    if crate::fortios::rejected_command(&version) && crate::fortios::fips_banner_pending(&version) {
        let _ = device.run("a").await;
    }
    let mut answers = Vec::new();
    for command in questions(&version) {
        let out = device.run(&command).await.unwrap_or_default();
        commands.push(command.clone());
        answers.push((command, out));
    }
    let mut info = from_answers(&hostname, &version, &answers);
    info.commands = commands;
    info
}

/// Reads what was answered. Pure, so it is tested without a device.
pub fn from_answers(hostname: &str, version: &str, answers: &[(String, String)]) -> DeviceInfo {
    let dialect = dialect_for(version);
    let answer = |command: &str| answers.iter().find(|(c, _)| c == command).map(|(_, a)| a.as_str()).unwrap_or("");
    let identity_answers: Vec<String> = dialect.identity_commands().iter().map(|c| answer(c).to_string()).collect();
    let identity = dialect.identity(version, &identity_answers);

    let aruba_switch = crate::arubasw::is_arubaos_switch(version);
    let aruba = if aruba_switch { crate::arubasw::parse_system(answer(ARUBA_SYSTEM)) } else { Default::default() };
    let forti = crate::fortios::rejected_command(version).then(|| crate::fortios::parse_system_status(answer(FORTI_STATUS)));

    // The first stack table that reads. Kept whole for the model an
    // ArubaOS-Switch states nowhere else; reported as a stack only when it
    // is more than one box.
    let table = dialect.stack_commands().iter().find_map(|c| crate::stacking::parse_any(answer(c)));
    let stack = table.clone().filter(StackInfo::is_really_stacked);

    let nvue = (dialect.family() == Family::Cumulus && crate::nvue::is_cumulus(version)).then(|| {
        let mut replies = vec![version];
        replies.extend(identity_answers.iter().map(String::as_str));
        let id = crate::nvue::identity(&replies);
        format!("{} {}", id.product.unwrap_or_else(|| "Cumulus Linux".into()), id.release.unwrap_or_default()).trim().to_string()
    });

    let model = match &forti {
        Some(s) if s.model.is_some() => s.model.clone(),
        _ if aruba_switch => table.as_ref().and_then(crate::arubasw::model_of),
        _ if crate::dell::detect(version).is_some() => {
            crate::dell::model_of(version).or_else(|| crate::crawl::platform_from_version(version))
        }
        _ if identity.model.is_some() => identity.model.clone(),
        _ => crate::crawl::platform_from_version(version),
    };
    let serials = if aruba_switch {
        aruba.serials.clone()
    } else if let Some(serial) = forti.as_ref().and_then(|s| s.serial.clone()) {
        vec![serial]
    } else if !identity.serials.is_empty() {
        identity.serials.clone()
    } else {
        crate::crawl::serials_in_version(version)
    };
    let software = match &forti {
        Some(s) if s.version.is_some() => s.version.clone(),
        _ if nvue.is_some() => nvue,
        _ if aruba.software_revision.is_some() => aruba.software_revision.clone(),
        _ => crate::crawl::first_line(version).map(str::to_string),
    };
    let uptime_seconds = match &forti {
        Some(_) => crate::uptime::parse_uptime(answer(FORTI_PERFORMANCE)),
        None => crate::uptime::parse_uptime(version),
    };
    DeviceInfo {
        hostname: forti.as_ref().and_then(|s| s.hostname.clone()).filter(|_| hostname.is_empty()).unwrap_or_else(|| hostname.to_string()),
        family: dialect.name().to_string(),
        model,
        serials,
        software,
        mac: aruba.base_mac.clone().or_else(|| base_mac(version)),
        uptime_seconds,
        unverified: !dialect.verified_against_hardware() || stack.as_ref().is_some_and(|s| s.unverified),
        stack,
        commands: Vec::new(),
    }
}

/// `Base Ethernet MAC Address : 00:11:22:33:44:55`, as IOS prints it in its
/// version. The first one: on a stack that is the active member's.
fn base_mac(version: &str) -> Option<String> {
    version.lines().find_map(|line| {
        let (label, value) = line.split_once(':')?;
        label.trim().eq_ignore_ascii_case("Base Ethernet MAC Address").then(|| crate::arp::normalise_mac(value.trim())).flatten()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dialect::Dialect;

    /// A two-member stack in the shape IOS prints its version. Made up.
    const IOS: &str = "\
Cisco IOS Software, IOS-XE Software, Catalyst L3 Switch Software, Version 16.12.4
EXAMPLE-SW uptime is 2 weeks, 1 day, 3 hours, 4 minutes
cisco C9300-48P (X86) processor with 1331521K bytes of memory.
Base Ethernet MAC Address       : 00:11:22:33:44:55
Model Number                    : C9300-48P
System Serial Number            : FOC0000TEST

Switch 02
---------
Base Ethernet MAC Address       : 00:11:22:33:44:66
System Serial Number            : FOC0001TEST
";

    #[test]
    fn a_version_alone_names_the_box() {
        let info = from_answers("EXAMPLE-SW", IOS, &[]);
        assert_eq!(info.hostname, "EXAMPLE-SW");
        assert_eq!(info.model.as_deref(), Some("C9300-48P"));
        assert_eq!(info.serials, vec!["FOC0000TEST", "FOC0001TEST"]);
        assert!(info.software.as_deref().unwrap_or("").contains("16.12.4"));
        assert_eq!(info.mac.as_deref(), crate::arp::normalise_mac("00:11:22:33:44:55").as_deref());
        assert_eq!(info.uptime_seconds, Some(((2 * 7 + 1) * 24 + 3) * 3600 + 4 * 60));
        assert_eq!(info.stack, None, "no stack table was answered");
    }

    #[test]
    fn a_fortigate_is_read_from_its_status() {
        let refused = "Unknown action 0\nCommand fail. Return code -1\n";
        let status = "Version: FortiGate-60F v7.0.0,build0000\nSerial-Number: FGT0000TEST\nHostname: EXAMPLE-FW\n";
        let asked = questions(refused);
        assert_eq!(asked, vec![FORTI_STATUS, FORTI_PERFORMANCE]);
        let info = from_answers("EXAMPLE-FW", refused, &[(FORTI_STATUS.to_string(), status.to_string())]);
        assert_eq!(info.serials, vec!["FGT0000TEST"]);
        assert!(info.software.is_some());
    }

    /// The point of the thing: whatever the platform, nothing it is asked is
    /// a question about another device or about the network around it.
    #[test]
    fn no_platform_is_asked_about_its_neighbours_or_its_tables() {
        let mut checked = 0;
        for dialect in crate::dialect::all() {
            let d: &dyn Dialect = dialect.as_ref();
            let mut asked: Vec<String> = Vec::new();
            asked.extend(d.paging_off().map(str::to_string));
            asked.extend(d.identity_commands().iter().map(|c| c.to_string()));
            asked.extend(d.stack_commands().iter().map(|c| c.to_string()));
            asked.extend([ARUBA_SYSTEM, FORTI_STATUS, FORTI_PERFORMANCE].map(str::to_string));
            asked.extend(crate::dialect::VERSION_COMMANDS.iter().map(|c| c.to_string()));

            let mut never: Vec<&str> = Vec::new();
            never.extend(d.cdp_readings().iter().map(|r| r.command));
            never.extend(d.lldp_readings().iter().map(|r| r.command));
            never.extend(d.ap_readings().iter().map(|r| r.command));
            never.extend(d.mac_table_readings().iter().map(|r| r.command));
            never.extend(d.interface_readings().iter().map(|r| r.command));
            never.extend(d.port_channel_readings().iter().map(|r| r.command));
            never.extend(d.policy_route_readings().iter().map(|r| r.command));
            never.extend(d.arp_commands());
            never.extend(d.route_commands());
            never.extend(d.default_route_commands());
            for a in &asked {
                assert!(!never.contains(&a.as_str()), "{}: `{a}` reads a table, not an identity", d.name());
                // Whole words: `/system routerboard print` names hardware.
                let l = a.to_ascii_lowercase();
                let words: Vec<&str> = l.split(|c: char| !c.is_ascii_alphanumeric() && c != '-').collect();
                for word in ["cdp", "lldp", "neighbor", "neighbors", "neighbour", "neighbours", "arp", "address-table", "mac-address", "route", "routes", "ssh", "telnet", "ping", "traceroute", "configure", "conf"] {
                    assert!(!words.contains(&word), "{}: `{a}` is not an identity question ({word})", d.name());
                }
            }
            checked += 1;
        }
        assert!(checked > 5, "the dialects were not walked");
    }

    #[test]
    fn what_is_asked_is_what_the_list_says() {
        // An IOS device: its stack table and nothing about anything else.
        let asked = questions(IOS);
        assert!(asked.iter().any(|c| c.contains("switch")), "{asked:?}");
        assert!(asked.iter().all(|c| c.starts_with("show ")), "{asked:?}");
    }
}
