//! A Nexus read in NX-OS's own spellings and layouts.
//!
//! Two sources, and each test says which it uses:
//!
//! * **Real NX-OS output** — the samples that travel with the vendored
//!   ntc-templates (`resources/templates/tests/cisco_nxos`): the
//!   port-channel summary, the ARP table, interface status.
//! * **Cisco's own documentation** — the sample output printed in the Nexus
//!   9000 Series NX-API CLI Reference, Release 9.3(x) (`show mac
//!   address-table`, `show port-channel summary`), and in the Nexus 7000
//!   Series NX-OS Layer 2 Switching Command Reference (`show interface
//!   trunk`). Documentation, not a capture: these stay unverified until
//!   output from a switch replaces them.

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

/// `show interface trunk` as Cisco's Layer 2 Switching Command Reference
/// prints it for NX-OS. The native VLAN is the second column, not the fifth
/// as on IOS; the section headings are capitalised differently; and the
/// VLANs carried are under `STP Forwarding`.
const TRUNKS_DOCUMENTED: &str = "\
switch# show interface trunk

--------------------------------------------------------------------------------
Port          Native  Status        Port
              Vlan                  Channel
--------------------------------------------------------------------------------
Eth1/33       1       trunking      --
Eth1/34       1       trunking      --

--------------------------------------------------------------------------------
Port          Vlans Allowed on Trunk
--------------------------------------------------------------------------------
Eth1/33       1,10
Eth1/34       1,10

--------------------------------------------------------------------------------
Port          Vlans Err-disabled on Trunk
--------------------------------------------------------------------------------
Eth1/33       none
Eth1/34       none

--------------------------------------------------------------------------------
Port          STP Forwarding
--------------------------------------------------------------------------------
Eth1/33       1,10
Eth1/34       1,10

--------------------------------------------------------------------------------
Port          VTP in spanning tree forwarding state and not pruned
--------------------------------------------------------------------------------
Eth1/33       1
Eth1/34       1
switch#
";

#[test]
fn the_documented_trunk_table_is_read() {
    let trunks = corelens_discover::vlans::parse_trunks(TRUNKS_DOCUMENTED);
    assert_eq!(trunks.len(), 2, "{trunks:?}");
    for t in &trunks {
        assert_eq!(t.mode, "trunk");
        assert_eq!(t.vlan, Some(1), "{t:?}");
        // What spanning tree forwards — not the shorter list VTP has not pruned.
        assert_eq!(t.trunk_vlans, [1, 10], "{t:?}");
    }
    assert_eq!(trunks[0].port, "Eth1/33");
}

/// The same layout with what the documented sample does not show: a native
/// VLAN other than 1, a bundle and its member, a range. Written in the
/// documented layout rather than captured.
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

/// `show mac address-table vlan 10` as the Nexus 9000 NX-API CLI Reference,
/// Release 9.3(x), prints it: a marker column ahead of the VLAN — `+` for an
/// entry learned over the vPC peer link — and two more legend entries than
/// older releases have.
const MAC_9K_DOCUMENTED: &str = "\
Switch# show mac address-table vlan 10
Legend:
        * - primary entry, G - Gateway MAC, (R) - Routed MAC, O - Overlay MAC
        age - seconds since last seen,+ - primary entry using vPC Peer-Link,
        (T) - True, (F) - False, C - ControlPlane MAC, ~ - vsan
   VLAN     MAC Address      Type      age     Secure NTFY Ports
---------+-----------------+--------+---------+------+----+------------------
+   10     0000.0c9f.f00a   dynamic  0         F      F    Po50
*   10     0002.0233.000a   dynamic  0         F      F    Po50
";

#[test]
fn a_nexus_9000s_learned_mac_entries_keep_their_vlan() {
    let entries = corelens_discover::mac_table::parse_mac_table(MAC_9K_DOCUMENTED);
    assert_eq!(entries.len(), 2, "{entries:?}");
    for e in &entries {
        assert_eq!((e.port.as_str(), e.vlan.as_deref()), ("Po50", Some("10")), "{e:?}");
    }
    assert_eq!(entries[0].mac, "00000c9ff00a");
}

/// The real sample from an older release holds only static entries, which a
/// crawl does not keep: none of its rows — the gateway MAC on `sup-eth1`,
/// the drop entries — becomes a device.
#[test]
fn the_switchs_own_and_static_entries_are_not_devices() {
    let real = nxos!("show_mac_address-table/cisco_nxos_show_mac_address-table.raw");
    assert!(real.contains("sup-eth1(R)"));
    assert!(corelens_discover::mac_table::parse_mac_table(real).is_empty());
}

/// `show port-channel summary` as the Nexus 9000 NX-API CLI Reference,
/// Release 9.3(x), prints it: two flags the older samples do not have
/// (`b`, `p`), the same table.
const PORT_CHANNELS_9K_DOCUMENTED: &str = "\
Switch# show port-channel summary
Flags:  D - Down        P - Up in port-channel (members)
        I - Individual  H - Hot-standby (LACP only)
        s - Suspended   r - Module-removed
        b - BFD Session Wait
        S - Switched    R - Routed
        U - Up (port-channel)
        p - Up in delay-lacp mode (member)
        M - Not in use. Min-links not met
--------------------------------------------------------------------------------
Group Port-       Type     Protocol  Member Ports
      Channel
--------------------------------------------------------------------------------
1     Po1(SU)     Eth      LACP      Eth1/31(P)
2     Po2(SU)     Eth      LACP      Eth1/39(P)   Eth1/41(P)
";

#[test]
fn a_nexus_9000s_port_channel_summary_is_read() {
    let bundles = corelens_discover::etherchannel::parse_nxos_port_channel_summary(PORT_CHANNELS_9K_DOCUMENTED);
    let read: Vec<(&str, &str, Vec<&str>)> = bundles.iter().map(|b| (b.name.as_str(), b.protocol.as_str(), b.members.iter().map(String::as_str).collect())).collect();
    assert_eq!(read, [("Po1", "LACP", vec!["Eth1/31"]), ("Po2", "LACP", vec!["Eth1/39", "Eth1/41"])]);
}
