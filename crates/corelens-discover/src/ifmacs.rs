//! A device's own interfaces' MAC addresses, off its interface listing.
//!
//! What a cable is plugged into can be told without CDP or LLDP: a switch
//! learns the MAC address of whatever is on each of its ports, so the port
//! that learned one of a firewall's own interface addresses is the port that
//! firewall is plugged into. This reads the firewall's (or router's, or
//! switch's) side: which of its interfaces has which address.
//!
//! **Built from vendor documentation, not captured output** (the exception
//! recorded for the documented dialects): the layouts below are the ones
//! Cisco documents for IOS, IOS XE, NX-OS, ASA and FTD `show interface`, and
//! Juniper for `show interfaces`. Each test fixture says so. A capture from a
//! device replaces them.
//!
//! IOS and IOS XE: `GigabitEthernet0/1 is up, line protocol is up` then
//! `  Hardware is …, address is 0050.56a1.0001 (bia 0050.56a1.0001)`.
//! NX-OS: `Ethernet1/1 is up` then `  Hardware: …, address: 0022.bdf8.0001 (bia …)`.
//! ASA and FTD: `Interface Ethernet1/1 "outside", is up, line protocol is up`
//! then `\tMAC address 00a6.cafe.0001, MTU 1500`.
//! Junos: `Physical interface: ge-0/0/0, Enabled, Physical link is Up` then
//! `  Current address: 00:05:86:71:1a:01, Hardware address: …`.

use crate::arp::normalise_mac;

/// One of the device's interfaces and its address.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnMac {
    /// The interface, as the device writes it.
    pub port: String,
    /// Twelve lowercase hex digits.
    pub mac: String,
}

/// The interface a header line opens, if it is one.
fn header(line: &str) -> Option<String> {
    let t = line.trim_end();
    // Headers start at the left edge; their details are indented.
    if t.is_empty() || t.starts_with([' ', '\t']) {
        return None;
    }
    if let Some(rest) = t.strip_prefix("Physical interface: ") {
        return rest.split([',', ' ']).next().filter(|s| !s.is_empty()).map(str::to_string);
    }
    let rest = t.strip_prefix("Interface ").unwrap_or(t);
    let name = rest.split([' ', ',']).next()?;
    // `X is up`, `X "nameif", is up`, `X is administratively down`.
    let after = rest[name.len()..].trim_start();
    let after = if after.starts_with('"') { after.splitn(3, '"').nth(2).unwrap_or("").trim_start_matches(',').trim_start() } else { after };
    (after.starts_with("is ") && !name.is_empty()).then(|| name.to_string())
}

/// The address a detail line gives, if it gives one.
fn address(line: &str) -> Option<String> {
    let l = line.trim();
    for key in ["address is ", "address: ", "MAC address ", "Current address: "] {
        if let Some(at) = l.find(key) {
            // `Hardware: …, address: X` on NX-OS; never the `(bia …)` after it.
            let raw = l[at + key.len()..].split([' ', ',', '(']).next().unwrap_or("");
            if let Some(mac) = normalise_mac(raw) {
                return Some(mac);
            }
        }
    }
    None
}

/// Every interface that states an address, in the order listed. An
/// interface whose listing gives none (a tunnel, a loopback) is left out.
pub fn parse_interface_macs(out: &str) -> Vec<OwnMac> {
    let mut found = Vec::new();
    let mut current: Option<String> = None;
    for line in out.lines() {
        if let Some(name) = header(line) {
            current = Some(name);
            continue;
        }
        if let (Some(port), Some(mac)) = (&current, address(line)) {
            if !found.iter().any(|f: &OwnMac| &f.port == port) {
                found.push(OwnMac { port: port.clone(), mac });
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    // Every fixture here is reconstructed from the vendor's documentation of
    // the command's output, with invented addresses, not captured.

    #[test]
    fn ios_names_the_address_and_not_the_burned_in_one_after_it() {
        let out = "GigabitEthernet0/1 is up, line protocol is up \n  Hardware is iGbE, address is 0050.56a1.0001 (bia 0050.56a1.00ff)\n  Internet address is 192.0.2.1/24\nLoopback0 is up, line protocol is up \n  Hardware is Loopback\n  Internet address is 198.51.100.1/32\nGigabitEthernet0/2 is administratively down, line protocol is down \n  Hardware is iGbE, address is 0050.56a1.0002 (bia 0050.56a1.0002)\n";
        assert_eq!(
            parse_interface_macs(out),
            vec![
                OwnMac { port: "GigabitEthernet0/1".into(), mac: "005056a10001".into() },
                OwnMac { port: "GigabitEthernet0/2".into(), mac: "005056a10002".into() },
            ]
        );
    }

    #[test]
    fn nxos_writes_address_with_a_colon() {
        let out = "Ethernet1/1 is up\nadmin state is up, Dedicated Interface\n  Hardware: 1000/10000 Ethernet, address: 0022.bdf8.0001 (bia 0022.bdf8.0001)\n  MTU 9216 bytes\n";
        assert_eq!(parse_interface_macs(out), vec![OwnMac { port: "Ethernet1/1".into(), mac: "0022bdf80001".into() }]);
    }

    #[test]
    fn an_ftd_or_asa_names_its_interface_and_nameif() {
        let out = "Interface Ethernet1/1 \"outside\", is up, line protocol is up\n  Hardware is EtherSVI, BW 1000 Mbps, DLY 10 usec\n\tMAC address 00a6.cafe.0001, MTU 1500\n\tIP address 192.0.2.10, subnet mask 255.255.255.0\nInterface Ethernet1/2 \"inside\", is up, line protocol is up\n\tMAC address 00a6.cafe.0002, MTU 1500\nInterface Management1/1 \"diagnostic\", is up, line protocol is up\n\tMAC address 00a6.cafe.00ff, MTU 1500\n";
        let got = parse_interface_macs(out);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0], OwnMac { port: "Ethernet1/1".into(), mac: "00a6cafe0001".into() });
        assert_eq!(got[1].port, "Ethernet1/2");
    }

    #[test]
    fn junos_reads_the_current_address() {
        let out = "Physical interface: ge-0/0/0, Enabled, Physical link is Up\n  Interface index: 148, SNMP ifIndex: 526\n  Current address: 00:05:86:71:1a:01, Hardware address: 00:05:86:71:1a:01\n";
        assert_eq!(parse_interface_macs(out), vec![OwnMac { port: "ge-0/0/0".into(), mac: "000586711a01".into() }]);
    }

    #[test]
    fn a_refusal_or_nothing_reads_as_no_interfaces() {
        assert!(parse_interface_macs("% Invalid input detected at '^' marker.\n").is_empty());
        assert!(parse_interface_macs("Syntax error: Illegal parameter\n").is_empty());
        assert!(parse_interface_macs("").is_empty());
    }
}
