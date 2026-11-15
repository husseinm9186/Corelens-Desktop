//! A Nexus read in NX-OS's own spellings and layouts.
//!
//! The port-channel, ARP and interface-status tables are real NX-OS output:
//! the samples that travel with the vendored ntc-templates
//! (`resources/templates/tests/cisco_nxos`). Two shapes have no sample
//! there — `show interface trunk`, and a MAC table with learned entries —
//! and are **reconstructed from Cisco's NX-OS command reference**, in the
//! layout of the real samples beside them; each says so where it is used,
//! and stays unverified until a capture from a switch replaces it.

use corelens_discover::dialect::{dialect_for, Family};

macro_rules! nxos {
    ($f:literal) => {
        include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../resources/templates/tests/cisco_nxos/", $f))
    };
}

const BANNER: &str = "Cisco Nexus Operating System (NX-OS) Software\nNXOS: version 9.3(8)\n";

#[test]
fn a_nexus_is_asked_for_its_bundles_in_its_own_words() {
    let d = dialect_for(BANNER);
    assert_eq!(d.family(), Family::CiscoNxOs);
    let asked: Vec<&str> = d.port_channel_readings().iter().map(|r| r.command).collect();
    assert_eq!(asked, ["show port-channel summary"], "NX-OS rejects `show etherchannel summary`");
}

/// `show ip arp` on a Nexus is the default VRF's table alone; a switch
/// managed through `mgmt0` has its neighbours in the management VRF. The
/// real sample below is the all-VRF table ("for all contexts").
#[test]
fn a_nexus_is_asked_for_the_arp_table_of_every_vrf() {
    let d = dialect_for(BANNER);
    assert_eq!(d.arp_commands(), ["show ip arp vrf all", "show ip arp"]);
    assert!(nxos!("show_ip_arp/cisco_nxos_show_ip_arp.raw").contains("IP ARP Table for all contexts"));
}

#[test]
fn its_port_channel_summary_is_read_with_members_that_wrap() {
    let d = dialect_for(BANNER);
    let read = d.port_channel_readings()[0].parse;
    let bundles = read(nxos!("show_port-channel_summary/cisco_nxos_show_port-channel_summary2.raw"));
    let po1 = bundles.iter().find(|b| b.name == "Po1").expect("Po1");
    assert_eq!(po1.protocol, "LACP");
    assert_eq!(po1.members, ["Eth1/1", "Eth2/1"]);
    // Four members over two lines.
    let po811 = bundles.iter().find(|b| b.name == "Po811").expect("Po811");
    assert_eq!(po811.members, ["Eth15/8", "Eth15/28", "Eth16/8", "Eth16/28"]);
    assert!(bundles.len() >= 20, "{}", bundles.len());

    let other = read(nxos!("show_port-channel_summary/cisco_nxos_show_port-channel_summary3.raw"));
    assert!(!other.is_empty() && other.iter().all(|b| b.name.starts_with("Po")), "{other:?}");
}

#[test]
fn its_vlan_questions_are_spelled_the_way_it_answers_them() {
    assert_eq!(
        corelens_discover::vlans::commands_for(Family::CiscoNxOs),
        ["show vlan brief", "show interface trunk", "show interface status"],
        "NX-OS rejects `show interfaces …`"
    );
    assert_eq!(
        corelens_discover::vlans::commands_for(Family::CiscoIos),
        ["show vlan brief", "show interfaces trunk", "show interfaces status"],
        "IOS is asked what it always was"
    );
}

#[test]
fn its_interface_status_and_arp_are_read() {
    let ports = corelens_discover::vlans::parse_interface_status(nxos!("show_interface_status/cisco_nxos_show_interface_status.raw"));
    assert!(ports.iter().any(|p| p.port == "Eth1/2" && p.vlan == "1" && p.status == "disabled"), "{:?}", ports.get(2));
    let arp = corelens_discover::arp::parse_arp_table(nxos!("show_ip_arp/cisco_nxos_show_ip_arp.raw"));
    assert_eq!(arp.get("3c60f40ef9c3").map(String::as_str), Some("1.1.1.2"));
    assert!(arp.len() >= 20, "{}", arp.len());
}

/// Reconstructed from the NX-OS command reference's `show interface trunk`:
/// the native VLAN is the second column, not the fifth as on IOS, and the
/// section headings are capitalised differently.
const TRUNKS: &str = "\
--------------------------------------------------------------------------------
Port          Native  Status        Port
              Vlan                  Channel
--------------------------------------------------------------------------------
Eth1/1        1       trunking      Po10
Eth1/47       99      trunking      --
Po10          1       trunking      --

--------------------------------------------------------------------------------
Port          Vlans Allowed on Trunk
--------------------------------------------------------------------------------
Eth1/1        10,20,30-32
Eth1/47       1-4094
Po10          10,20,30-32

--------------------------------------------------------------------------------
Port          Vlans Err-disabled on Trunk
--------------------------------------------------------------------------------
Eth1/1        none
Eth1/47       none
Po10          none

--------------------------------------------------------------------------------
Port          STP Forwarding
--------------------------------------------------------------------------------
Eth1/1        none
Eth1/47       1,99
Po10          10,20,30-32
";

#[test]
fn its_trunks_are_read_with_their_native_and_carried_vlans() {
    let trunks = corelens_discover::vlans::parse_trunks(TRUNKS);
    let by = |port: &str| trunks.iter().find(|t| t.port == port).unwrap_or_else(|| panic!("{port} in {trunks:?}"));
    assert_eq!(by("Eth1/47").vlan, Some(99));
    assert_eq!(by("Eth1/47").trunk_vlans, [1, 99], "what is forwarding, where the switch says");
    assert_eq!(by("Po10").vlan, Some(1));
    assert_eq!(by("Po10").trunk_vlans, [10, 20, 30, 31, 32]);
    // A bundle member forwards nothing of its own; what it is allowed stands.
    assert_eq!(by("Eth1/1").trunk_vlans, [10, 20, 30, 31, 32]);
    assert_eq!(trunks.len(), 3);
}

/// The header and legend are the real sample's; the two learned rows are
/// reconstructed in its layout (the sample holds only static entries, and a
/// crawl keeps only learned ones).
#[test]
fn its_learned_mac_entries_keep_their_vlan() {
    let real = nxos!("show_mac_address-table/cisco_nxos_show_mac_address-table.raw");
    let header: String = real.lines().take_while(|l| !l.starts_with("G ")).map(|l| format!("{l}\n")).collect();
    assert!(header.contains("MAC Address") && header.contains("Ports"), "{header}");
    let table = format!(
        "{header}*  145     0050.56a1.2b3c   dynamic  0         F      F    Eth1/12\n+  146     0050.56a1.2b3d   dynamic  10        F      F    Po10\n"
    );
    let entries = corelens_discover::mac_table::parse_mac_table(&table);
    assert_eq!(entries.len(), 2, "{entries:?}");
    assert_eq!((entries[0].mac.as_str(), entries[0].port.as_str(), entries[0].vlan.as_deref()), ("005056a12b3c", "Eth1/12", Some("145")));
    assert_eq!((entries[1].port.as_str(), entries[1].vlan.as_deref()), ("Po10", Some("146")));
}
