# Release notes

Newest first.

## 2.13.0 — 2026-10-22

**Projects shared through a company folder**
- Choose the folder your company keeps its projects in — a SharePoint
  library synced through OneDrive, a mapped drive, any folder every
  engineer's machine sees — under *Settings → Application → Shared
  projects* or on the start screen. Keep a project there with one press
  under its *Settings → Folders*, or tick it when you create one: it is
  written as `project.corelens` with a readable `project.yaml` beside it
  after every save, and the start screen lists every project in the
  folder for *Open from the shared folder* on any machine.
- Whoever saved last is what everyone opens: opening a kept project reads
  the shared copy first and takes it when a colleague has saved since. A
  lock file names who has a project open; a second engineer sees a banner
  and is told the later save wins, not stopped. Saved logins, event
  history and probe samples never go to the folder.

**Exports**
- *Project package with saved credentials* carried every credential in the
  vault, other projects' included. It now carries the ones this project
  refers to and no other, and the status line says how many.
- *This page* at the top of the Export menu now narrows every export, not
  only the drawings: the CSV tables list that page, and a package or a
  folder exported with it is a one-page project of that page and its
  checks, which imports as one.

**The chrome**
- Every menu in the top bar closes when you click anywhere else or press
  Escape, and opening one closes the others. On a short window the Export
  menu stays inside it and scrolls.
- A click on empty canvas clears the selection, a multi-selection too.
- A saved-credential rule under Discover devices is one line again:
  match, value, credential and remove side by side.
- The breadcrumb above the canvas names a folded group or a device, never
  by its id.
- A Catalyst 9400 chassis (C9404R, C9407R, C9410R) classifies as a switch.
- The Views panel's help line reads as a sentence.

## 2.12.4 — 2026-10-22

**Stay inside these subnets is a boundary again**
- A crawl with subnets listed under *Stay inside these subnets* no longer
  logs in to anything outside them. Since 2.7 a neighbour on a private
  address was followed regardless, and on a real network every address is
  private, so a survey of one /24 walked three hops into the rest of the
  estate. A neighbour outside the subnets is still drawn from what its
  neighbour said, and never dialled, so its own neighbours are never seen.
  A seed you typed is always dialled. Both engines, the default gateway
  and the address chosen from a device's ARP table follow the same rule.
- **Discover everything**, a tick under the subnets, is the old behaviour
  on purpose: every neighbour of a kind ticked under *Log in to* is
  followed wherever its private address is, and the subnets then only add
  public ranges the crawl may enter. Off by default, remembered with the
  scan and in a profile. The note beside it, the dry run and the first
  line of the debug log all say which run you have set up.

**Catalyst 9400**
- A Catalyst 9400 chassis (C9404R, C9407R, C9410R) now classifies as a
  switch. The model list knew the family name and the one 9600 model it had
  met; a Catalyst 9000 is now recognised by the shape of its model number,
  so the next one needs no entry.

**Dependencies**
- `rustls-webpki` 0.103.16 and `webpki-roots` / `webpki-root-certs` 1.0.10,
  for this week's advisories on certificate verification and the bundled
  roots; they are what the collector's HTTPS clients verify device APIs
  with.

## 2.12.3 — 2026-10-17

**The strip's menus show again**
- Filter, Arrange, the grid, the page and the zoom menus in the canvas
  strip opened without showing anything since 2.10.0: the strip clipped
  whatever hung below it. They show now. The test that watched them was
  measuring where the panel was rather than whether it could be seen; it
  now checks what is under the pointer, for every menu in the strip.

**Dependencies**
- `rustls` 0.23.46 and `zip` 9, for the advisories published this week.
  The one remaining copy of the older `zip` is inside the updater plugin's
  path for zip-wrapped Windows updates, which these releases do not use;
  the reason is written beside the audit's ignore list.

## 2.12.2 — 2026-10-11

**The page fits around the diagram**
- *Fit page to content* draws the sheet around what is on it. A diagram
  that had drifted to the right no longer keeps an empty half-sheet on the
  left; a diagram smaller than one sheet gets a full-size sheet centred on
  it, and one that already sits inside the starting sheet keeps it. *Fit
  view* fits that sheet, so the diagram fills the window.

**Racks**
- A vertical PDU is drawn as a bar down the post, wide enough to read, with
  its name along it and a socket for each outlet; power cords land on the
  socket they are plugged into. The SVG and DXF exports draw the same.
- A zero-U item can stand down either post: choose it and press *Move to
  the left post*, or back to the right. The faceplates make way on that
  side, and the exports follow.
- A chosen box in a rack shows a grip and a bar along its bottom edge. Drag
  the bar to make the box taller or shorter by whole U — the top stays where
  it is, the new span is previewed, and a span another box holds is refused
  with the reason. The inspector's *Rack units* field still works.

## 2.12.1 — 2026-10-10

**A new signing certificate, under the new name**
- The Windows installer is now signed by `corelens.us Code Signing`, issued
  by the app's own root, `corelens.us-Root-CA` (valid to October 2036).
  Builds up to 2.12.0 were signed by the Coreview-era certificate; a machine
  that trusted that root must import the new one as well before this
  installer, and every one after it, validates. The steps are in
  `docs/INSTALL-WINDOWS.md`.
- The root's public certificate ships inside the installer, as
  `corelens-root-ca.crt` in the application's folder, as well as beside it
  on the release page, so it is to hand on every machine the app is on.
- The build fails if the certificate in the repository's secret is not the
  one published in `brand/`, so the install notes always describe the
  certificate that actually signed the file.

## 2.12.0 — 2026-10-10

**Coreview is now Corelens Desktop**
- The app has a new name. It installs as **Corelens Desktop**, beside the
  Coreview it replaces rather than over it; uninstall Coreview once
  Corelens Desktop has opened your projects.
- Nothing is left behind. The first time Corelens Desktop starts, it copies
  what Coreview kept on this computer into its own folders: every project
  and folder, the saved logins (still encrypted), the settings, the logs
  and diagnostics, the view settings, each project's undo history and any
  unsaved recovery copy. A vault key kept in the system keychain is moved
  across, so the vault still opens by itself. Coreview's own folders are
  copied, not moved, and are never touched again.
- `.coreview` project files, and icon folders described by a
  `coreview-stencils.json`, open as before. New exports are `.corelens`.
- Close Coreview before the first start of Corelens Desktop, so what is
  copied is what was last saved.

**Tools, dissolved**
- The Tools screen is gone, and what it held lives where it is looked
  for: **Compare runs** in the panel's Monitor group; the two imports
  behind **Import…** in the top bar, side by side, then the one chosen;
  **Racks**, **Inventory** and **Settings** on the rail.
- The rail is two blocks: the modes that keep the diagram — Diagram,
  Discover, Monitor, Paths, Backups, Terminal — then, after a rule, the
  screens that take its place — Addresses, Racks, Inventory — with
  Settings at the foot. Ctrl+1 to Ctrl+9 follow that order.
- Every full screen has the same frame: *Diagram › its name* along the
  top with its tabs beside it, a tree down the left where it has one,
  content held to a readable width. **Esc**, or *Diagram* in that line,
  goes back to the drawing; there is no separate Back button.

**The address register as a workbench**
- The subnets down the left as a tree, each with how full it is; the
  chosen subnet's addresses on the right; **Allocate**, **Split & merge**
  and **Hierarchy** above them, starting from that subnet. Three views —
  Addresses, Utilisation, History — and the sites, tenants and fields
  behind a cog.

**One way of typing a filter**
- The search, the dock's lists and the register share one grammar: words,
  `field:value`, `-` to leave out, quotes for spaces. `status:down`,
  `type:router`, `tag:lab` and `kind:address` work where they mean
  something, and the dock lights what it kept on the canvas.
**The start screen**
- Before the first project, three ways in: **Map a network** from one
  address or name — a project is made, named after that address's /24 and
  the date, and opens on Discover with the seed already in — a blank
  project, or an import. The samples show the network each one draws,
  from its own devices. Once there are projects, the list comes first and
  the samples are a row of names beside it.

**Accessibility, built in**
- The rail is one stop for Tab: the arrow keys, Home and End move along
  it and Enter opens the item; **Ctrl+1** to **Ctrl+9** go straight to its
  first nine items from anywhere, and holding Ctrl shows the digits.
- Buttons and fields are at least 32 px tall, small buttons and tabs at
  least 28, checkboxes 18; the focus ring sits just outside a control's
  border instead of over the next one, and a field shows focus with a
  ring as well as its border.
- A table row that does something when clicked takes Tab and Enter, and
  Up, Down, Home and End move between rows; moving through the
  monitored list no longer nudges the device the last row selected.
- A device's recent-status strip takes focus: Left and Right move a cursor
  along it, with the time and status at the cursor printed underneath —
  and, with no cursor, the time and status now.
- High contrast is a bigger, heavier build: never under 115 %, controls
  with two-pixel edges, links underlined, the open tab marked by a heavy
  underline, the row under the pointer outlined. It is in the command
  palette as well as Settings.

**What a link is, in its line**
- A bundle is drawn as a double line, a tunnel dashed, a logical (layer-3)
  hop dotted and a transit circuit heavier, so what a link is still reads
  when its labels are hidden. Corelens works the kind out from what a
  crawl found — a port-channel's members, a tunnel, a routed hop — or from
  a WAN cable type; **Kind** in the link's inspector sets it by hand. A
  line style chosen on the link still wins. The export draws the same.
  Discovered tunnels used to be dotted and layer-3 hops dashed; they now
  follow the kinds.
- Orthogonal links turn with an 8 px corner.
- Port chips that would land on each other — two neighbouring devices'
  chips, say — are slid apart along their own links. A device with more
  than three links shows *5 links* under its name and keeps its chips
  until the link or the device is selected or pointed at, or you zoom in
  past 120 %.
- A traced path puts an arrow on each link along it, pointing the way the
  packet goes, and takes them away again when the trace is cleared.

## 2.11.0 — 2026-10-10

**Arrange by layer**
- The layered arrangement is a button beside Fit, and goes by that name
  everywhere it appears. Tiers are 160 px apart and neighbours 96 px; the
  order within a tier is settled by barycentre sweeps in both directions,
  keeping the order with the fewest crossings; each device is centred over
  what hangs off it; a fan of more than twelve single-link devices wraps
  into two rows under its parent; a group the types say nothing about is
  ranked from the device fewest hops from the rest of it.
- A device moved by hand after an arrangement is pinned: the next
  arrangement leaves it where it was put, gathers what hangs off it
  underneath, and says how many it left. **Unpin moved devices** on the
  Arrange menu releases them. **Lay out radially** is on the Arrange menu
  as well.

**The words for a device's health**
- *Up* for a device that answers, *Not checked* for one no check has run
  against — a different thing from *Down*, a check that got no reply. Not
  checked shows as a dashed outline, not a filled dot, because nothing was
  measured. The top bar's four health counts are buttons now: each opens
  the monitored list it stands for, Down filtered to the down devices. A
  project no check has run on says so, with Start checks, at the top of
  the list.

**Discover and the terminal dock on the right**
- Discovering devices and the terminal open down the right of the window,
  beside the inspector rather than in place of it: Discover at a narrow
  column with its step headers staying in sight and a footer carrying the
  Discover button and a one-line summary of the run; the terminal at half
  the window with its session tabs and its own footer. The wide tables —
  the monitored objects, the paths, the backups — stay along the bottom.
  The side is kept per tab, so moving one does not move the others.

**Clusters: chips, a breadcrumb and the dock as a tree**
- A device holding six or more folds to a 22 px chip that says what is
  inside and the worst of it — *12 access · 2 down* — and opens on a
  click, with the view brought to the fan. Zoomed out past 40 %, where
  the labels go, every such fan folds on its own; **Fold fans when zoomed
  out** on the Arrange menu turns that off. A breadcrumb at the top-left
  of the canvas names the way back in and how much is folded.
- **Collapse by site** folds each site (or group) into one box with a
  chip; **Collapse below** a role folds the fans under every device of
  that role; **Expand everything** opens all of it.
- The Monitored objects table is a site › role › device tree, links under
  each site. A branch counts what it holds and what is wrong; the
  branches that will not fit the panel fold first, the one holding the
  canvas selection stays open and its row comes into view, and a branch
  opened or closed by hand stays as it was left.
- The strip's menus close on Escape and on a click elsewhere, as the top
  bar's export menu already did.

## 2.10.0 — 2026-10-10

**The interface, redesigned**
- One graphite palette with a faint blue bias replaces four unrelated
  greys; status colours brightened so that *down* is the brightest of the
  four; the type scale re-valued so that body text is 14 px and nothing in
  the chrome is under 11 px; one uppercase treatment, for section
  headings only.
- A device's colour is what it is — seven families instead of twenty-six
  tints — and never changes with its health. Health is drawn beside the
  glyph: a ring and a badge for warning and down, a dot for healthy,
  nothing for a device nobody has checked. "Unknown" no longer prints under
  every node, a link nobody watches is a neutral grey, and a warning link is
  dotted as well as amber.
- The top bar: one health strip with dim zeros, **Start checks** as the one
  filled button that becomes a running pill with **Stop**, names that
  ellipsise instead of clipping, and the clock in sight on every screen.
- One strip of icon buttons above the canvas replaces two rows of word
  buttons and the floating drawing bar; Save, Undo and Redo move to the top
  bar; the page tabs are underlined.
- The dock shows the group the rail has chosen first, with underline tabs;
  the lists get a head with the filter and **All · Problems · Down**; a grip
  resizes the dock, a button maximises it, and a strip at its top says when
  anything is down.
- The inspector summarises the diagram when nothing is selected and names
  the selected device in its title.
- The targets table and the address register follow one contract: fixed
  columns, numbers right-aligned, identifiers in mono, a banded meter.
- The palette lists the network's shapes first as rows; one empty state
  speaks for every panel; Settings sits in two panes with a section nav.
- A chrome icon set replaces every borrowed Unicode symbol.
- A zoom-driven level of detail was built, measured on a production build
  against the canvas benchmark, and left out: it made nothing faster and
  zooming a 5,000-device page slower. The far view keeps the rule it had.

## 2.9.0 — 2026-10-09

**Updates**
- Tools → Settings has **Check for updates**: one request to this
  repository's GitHub Releases for the newest release's manifest, sent only
  when the button is pressed. It says you have the latest version, or names
  the newer one with its date and notes and offers **Install and restart**,
  which verifies the download's signature against the key built into the app
  before running the installer; a download that fails that check is refused
  and says so.
- **Check automatically when Corelens starts**, beside it, is off until
  ticked. With it on, the same request goes out at start and a newer
  release is announced by an **Update to …** button in the top bar. With it
  off, which is the default, Corelens contacts nobody.
- Every version is now published as a GitHub Release, with the installers,
  their updater signatures and checksums, and these notes beside them.

## 2.8.0 — 2026-10-09

**Backups**
- A backup can be taken over SNMP from Cisco IOS, IOS-XE and NX-OS: with
  the new tick on the Backups tab, each device is asked — one write into
  Cisco's configuration-copy table, with a read-write SNMP credential — to
  send its running or startup configuration to the SFTP server named under
  Tools → Settings, and Corelens collects the file from there and files it
  like any other capture, so history and before/after work unchanged. The
  SFTP server and its login live in Settings; the login is a vault kind of
  its own and is never offered to a device. A device without the table, or
  one that refuses the write, is read over SSH as before, and the run says
  why. Built from the MIB's definition; unverified on hardware until a
  Cisco has answered one.

## 2.7.1 — 2026-10-08

**Documentation**
- README, the Windows install guide, the signing notes and the architecture
  notes brought up to date: the installers CI publishes and their artifact
  names, the dependency and command counts, and where secrets live.
- The user guide describes every saved login being tried wherever Corelens
  logs in.

Nothing in the application changed since 2.7.0; this release rebuilds both
installers from the same code.

## 2.7.0 — 2026-10-08

**Discovery**
- Every login saved in the project is tried on a device that refuses the
  first, then any second login typed for the run, under both engines — and
  the same everywhere else Corelens logs in: backups, the SSH terminal, Path
  check, Tracert and Path-Trace's checks from a device. Only a refused login
  moves on to the next; an unreachable device is not retried once per login.
- A **Scan** box beside each subnet: the subnet is swept for devices that
  answer on the login port, and each one found is logged into, identified as
  a switch, router or firewall, and followed like any neighbour, so devices
  no CDP or LLDP neighbour names are still found.
- Switches, routers and firewalls on private addresses are followed even
  outside the subnets listed; the filter decides only which endpoints are
  logged into.
- NVIDIA Cumulus 5 (NVUE) and Aruba switches are read by both engines, with
  their neighbours' addresses.
- A Catalyst 9600 core classifies as a switch.

**Topology**
- Point-to-point routed links (/30, /31, /127) are drawn between the two
  devices that share them, on the right interfaces, even where CDP and LLDP
  are off, and say that the shared subnet is where they came from.
- A finished run keeps its devices as finished.

**SSH**
- Reach a device through the one that found it (device-hopping SSH).
- The terminal shows each login stage, and keeps its session when you leave
  the screen and come back.

**Interface**
- The canvas filter fits its window.

## 2.5.0 — 2026-09-30

The first release in which the catalog-driven collector is what **Discover
devices** runs, and the first checked against real hardware end to end.

**Discovery**
- *Discover devices* runs the Corelens collector by default: each device is
  recognised and sent only its own OS's read-only commands; CDP/LLDP
  neighbours, the default route's next hop and neighbours known only from
  ARP are followed within the hop, device and subnet limits. A next hop
  outside the private ranges is followed only when a subnet limit names it,
  so a login is never offered to a provider's router unasked. The classic
  crawler stays selectable.
- The run survives a tab change, lists each device that failed with the
  reason, and says which command a device last answered.
- A FortiGate's policies, address objects, FQDN resolutions, managed
  FortiSwitches and FortiAPs are read over its REST API when an API login
  is chosen; the login carries its HTTPS port.
- ArubaOS-CX switches are asked their own LLDP and MAC-table spellings.

- A stuck device no longer ends the run; Stop stops at once; a sidecar that
  stops answering is replaced.
- FortiOS 7.6 replies that ntc's templates refused are read by Corelens's own
  readers; a FortiSwitch has its own catalog.

**Topology and paths**
- The diagram's rows are the distance from the seed again, and devices seen
  on switch ports sit under their switch.
- Hosts known only from a firewall's ARP table hang off its interface, with
  their maker.
- A tunnel reached through itself no longer overflows the stack; a switch
  that only switches the frame no longer hides the firewall as first router;
  missing zone knowledge is Undetermined, not Deny.
- Identity and placement: all-zero MACs, placeholders sharing a first label,
  one cable claimed from both ends, known neighbours behind a router, crowds
  beside a placed box, two strangers on a port.
- Path-Trace from a LAN host starts at the gateway, not at a switch whose
  management address shares the subnet.

**Backups and tools**
- FortiGate and FortiSwitch backups read `show full-configuration`, send no
  `enable`, and allow 300 s per command.
- Tracert from a device shows each hop as it arrives and keeps them when the
  time limit is reached.

**Secrets**
- SNMP trap-host communities and RADIUS/TACACS server keys are scrubbed from
  support captures; a FortiGate's `ENC …` blobs never reach a database row;
  a parse error's quoted line is scrubbed.

**Sidecar**
- A slow SSH banner is waited for; a session a timeout closed is reported
  closed; a failed open closes its connection; the escalate step passes the
  vocabulary; FortiOS paging is restored outside the VDOM; an unlisted VDOM
  is refused.

**Packaging and build**
- Batch files are ASCII with CRLF, so the Windows build runs them as written.

- The sidecar starts with no console window on Windows.

Not in this release, logged: Tracert and Collect surviving a tab change
, a cable between two uncollected neighbours on the review,
VRF-aware next-hop resolution, and the EVE-NG platforms.
