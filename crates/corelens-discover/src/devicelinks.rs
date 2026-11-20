//! One device asked who is on its ports, and nobody gone to.
//!
//! A crawl asks a device for its neighbours and then visits them. This asks
//! and stops: the CDP and LLDP tables of the one address somebody chose,
//! handed back as they were read. It exists so a diagram somebody drew can
//! be checked against the devices on it — which port each drawn link is
//! really on, and which drawn links no device reports — without one new
//! address being contacted. What is done with the answer is the caller's;
//! nothing here follows a neighbour.
//!
//! With them, where the family prints one, its own port table — for what
//! each port is made of (copper, an SFP, a QSFP), which is how a drawn link
//! is told from another of a different kind.
//!
//! **What is asked is a list, and the list is checked.** After the version,
//! [`questions`] is every command that may be sent, and its test fails if
//! any is not a neighbour table or the port table, or is anything but a
//! read. No ARP, MAC or route table is asked for.
//!
//! No reader here is new: the dialect's own CDP and LLDP spellings, merged
//! the way a crawl merges them, each as verified as its dialect says.
use crate::dialect::dialect_for;
use crate::ssh::Device;
use crate::types::Neighbor;

/// What one device said about who is on its ports.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLinks {
    /// Its own name, off its prompt.
    pub hostname: String,
    /// The family its version identified, in words.
    pub family: String,
    /// Its chassis serials, where its version states them.
    pub serials: Vec<String>,
    /// Who it reports, by which of its ports and theirs.
    pub neighbors: Vec<Neighbor>,
    /// What each of its ports is made of, where it printed a port table:
    /// the port, and the type as the device words it (`10/100/1000BaseTX`,
    /// `SFP-10GBase-SR`, `QSFP-100G-SR4`). Empty where it printed none.
    pub ports: Vec<PortMedia>,
    /// Every command sent, in order, so whoever asked can say what was.
    pub commands: Vec<String>,
    /// True where the family's readers were built from documentation.
    pub unverified: bool,
}

/// One port and what the device says is in it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortMedia {
    pub port: String,
    pub media: String,
    pub speed: String,
}

/// The device's own port table, as this family spells it — asked only of
/// the families that answer it Cisco's way.
pub fn port_question(version: &str) -> Option<&'static str> {
    let dialect = dialect_for(version);
    dialect.reads_cisco_details().then(|| crate::vlans::commands_for(dialect.family())[2])
}

/// Every command that may be sent after the version: this family's
/// spellings of its two neighbour tables. A later spelling is sent only
/// when the one before it read as nothing.
pub fn questions(version: &str) -> Vec<String> {
    let dialect = dialect_for(version);
    let mut asked: Vec<String> =
        dialect.cdp_readings().iter().chain(dialect.lldp_readings()).map(|r| r.command.to_string()).collect();
    asked.extend(port_question(version).map(str::to_string));
    asked
}

/// Asks `device` who is on its ports. The session is left open for the
/// caller to close. A table the device refuses is an empty one, not an
/// error: a device with no CDP has still answered for LLDP.
pub async fn read(device: &mut Device) -> DeviceLinks {
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
    let dialect = dialect_for(&version);
    let mut tables: Vec<Vec<Neighbor>> = Vec::new();
    for readings in [dialect.cdp_readings(), dialect.lldp_readings()] {
        let mut found = Vec::new();
        for reading in readings {
            commands.push(reading.command.to_string());
            let out = device.run(reading.command).await.unwrap_or_default();
            found = (reading.parse)(&out);
            if !found.is_empty() {
                break;
            }
        }
        tables.push(found);
    }
    // What each port is made of. A device that refuses the table has still
    // answered for its neighbours.
    let mut ports = Vec::new();
    if let Some(command) = port_question(&version) {
        commands.push(command.to_string());
        let out = device.run(command).await.unwrap_or_default();
        ports = crate::vlans::parse_interface_status(&out)
            .into_iter()
            .map(|p| PortMedia { port: p.port, media: p.media, speed: p.speed })
            .collect();
    }
    let lldp = tables.pop().unwrap_or_default();
    let cdp = tables.pop().unwrap_or_default();
    DeviceLinks {
        hostname,
        family: dialect.name().to_string(),
        serials: crate::crawl::serials_in_version(&version),
        neighbors: crate::crawl::merge_neighbors(cdp, lldp),
        ports,
        commands,
        unverified: !dialect.verified_against_hardware(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dialect::Dialect;

    #[test]
    fn every_platform_is_asked_only_for_its_neighbour_tables_and_only_to_read() {
        let mut checked = 0;
        for dialect in crate::dialect::all() {
            let d: &dyn Dialect = dialect.as_ref();
            let asked: Vec<&str> = d.cdp_readings().iter().chain(d.lldp_readings()).map(|r| r.command).collect();
            // The port table is the one other thing asked, and it is a read
            // of the device's own ports.
            for family in [crate::dialect::Family::CiscoNxOs, crate::dialect::Family::CiscoIos] {
                let port_table = crate::vlans::commands_for(family)[2];
                assert!(port_table.starts_with("show interface") && port_table.ends_with(" status"), "{port_table}");
            }
            // A family with no neighbour protocol — a firewall that speaks
            // neither — is asked nothing at all.
            let mut never: Vec<&str> = Vec::new();
            never.extend(d.mac_table_readings().iter().map(|r| r.command));
            never.extend(d.arp_commands());
            never.extend(d.route_commands());
            never.extend(d.default_route_commands());
            never.extend(d.policy_route_readings().iter().map(|r| r.command));
            for a in &asked {
                assert!(!never.contains(a), "{}: `{a}` reads another table", d.name());
                let l = a.to_ascii_lowercase();
                let words: Vec<&str> = l.split(|c: char| !c.is_ascii_alphanumeric() && c != '-').collect();
                assert!(
                    // Cumulus 5 prints its LLDP neighbours in its interface
                    // listing; that one command is the table there.
                    ["cdp", "lldp", "neighbo", "remote-device"].iter().any(|w| l.contains(w)) || l == "nv show interface",
                    "{}: `{a}` does not read a neighbour table",
                    d.name()
                );
                for word in ["configure", "conf", "set", "delete", "write", "reload", "clear", "copy", "no"] {
                    assert!(!words.contains(&word), "{}: `{a}` is not a read", d.name());
                }
                checked += 1;
            }
        }
        assert!(checked > 20, "only {checked} commands were checked");
    }

    #[test]
    fn the_cisco_questions_are_the_two_tables_a_crawl_reads() {
        let asked = questions("Cisco IOS Software, C2960X Software, Version 15.2(7)E");
        assert_eq!(asked.first().map(String::as_str), Some("show cdp neighbors detail"));
        assert!(asked.iter().any(|c| c == "show lldp neighbors detail"), "{asked:?}");
        // And its own port table, last.
        assert_eq!(asked.last().map(String::as_str), Some("show interfaces status"));
        // Every one of them a read the backup's own rule would let through.
        for c in &asked {
            assert!(crate::showcmd::check_read_only(c).is_ok(), "`{c}` is not a read");
        }
    }
}
