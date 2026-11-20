# Release notes

Newest first.

## 2.18.2 — 2026-11-20

**The console has a tab of its own**
- Serial console sessions moved out of the SSH tab into a **Console** tab
  beside it in the dock, with the Console button, **Port** and **Speed**.
  The SSH tab is shells only again, and each tab counts its own sessions.

**Fixed**
- A right-click menu longer than the window ran off the bottom and its last
  entries could not be reached. Every menu, dropdown and dialog now stays
  inside the window and scrolls where it holds more than fits — the About
  dialog, which ran off both ends of a small window, among them.

## 2.18.1 — 2026-11-20

**Fill in drawn links from the devices**
- On the canvas's right-click menu. Every device drawn on the page with an
  address and a login is asked who is on its ports, and nothing else is
  contacted: no neighbour is followed and no device is added.
- A drawn link the devices confirm takes its port at each end and the
  colour of what the port is made of — Ethernet, SFP or QSFP.
- A drawn link no device reports turns purple.
- Management links (`mgmt0` and the like) are drawn sky blue and thinner,
  including ones not drawn before; **Hide management links** takes them off
  the page and out of exports.
- A legend says what the colours mean, on screen and in exported drawings.
- A new link kind, **Management**, can also be chosen by hand.

**Fixed**
- Several devices could be drawn as one, with every one's links on it,
  because they shared an address: an anycast gateway, the address a pair
  answers on, or any address one of them lists on an interface. Devices
  whose serial numbers differ are never taken for one device now, and an
  address that is not a device's management address no longer makes a
  differently named device that device. A device drawn under one name and
  reported under another at its management address is still recognised.
  Links already drawn wrongly are not removed: delete them, or the page,
  and discover again.

## 2.18.0 — 2026-11-20

**A serial console in the terminal**
- **Console** on the SSH tab, and **Console to this device** on a device's
  right-click menu, open a serial console as a tab beside the SSH sessions.
  The port is found for you: the USB serial adapter among this computer's
  serial ports, when exactly one is plugged in. With two, or none, it says
  so and you choose under **Port**.
- 9600 8N1 with no flow control; **Speed** changes the rate and is
  remembered. Nothing is sent to the device by opening the session.
- **Send break** on a console session, for a boot loader and password
  recovery. A console is logged, searched and reopened (Enter in an ended
  tab) like an SSH session.
- Tested against a pseudo-terminal; not yet against a real console cable.

**Session tabs in your order**
- Drag a session's tab onto another to move it there; **Ctrl+Shift+Left**
  and **Ctrl+Shift+Right** move the focused tab one place. The session in
  front stays in front and nothing about a session is disturbed.

**Under the surface**
- Each device on the canvas is drawn with two fewer page elements. Nothing
  looks different, and no change in panning or zooming speed was measured.

## 2.17.2 — 2026-11-16

**Fixed**
- **Get device info** threw its answer away if the page was turned while
  the device was still answering, and said the device was gone. The answer
  now lands on the device whichever page is in front.
- A device drawn on more than one page was filled in on one of them. Every
  drawing of it — a device managed on the same address — is filled, each
  keeping its own name and whatever was typed into it.
- Link-local addresses (`fe80::…`, `169.254.x.x`) were listed under a
  device's **Addresses** after a discovery or Get device info. Nothing off
  that link can reach them, so they are no longer listed. One typed by hand
  is kept; ones already listed stay until removed.

## 2.17.1 — 2026-11-15

**Fixed**
- A power supply's serial number was listed as a second chassis serial, so
  a single switch read "2 chassis". Only the chassis serial is taken now;
  the motherboard's, the power supply's and a fan tray's are not. Run **Get
  device info** again on a device that shows the extra serial to correct it.
- A device drawn on more than one page was listed, and backed up, once per
  page. It is one device to a backup now.
- Two links between the same two devices, both dropped on the same
  connection points, were drawn exactly on top of each other. They are
  drawn side by side.

**A backup files the device's tables too**
- Every backup also files each device's own interface, ARP, MAC address and
  routing tables, asked the way its platform spells them and read-only.
  Untick **Interface, ARP, MAC and routing tables** on the Backups tab to
  leave them out; the choice is remembered.

**A device's interface addresses, under Checks**
- A discovery lists every address on a device's own interfaces in its
  **Addresses**, named after the interface. The address it is managed on is
  the primary. Addresses and labels typed by hand are kept — a re-discovery
  used to replace the whole list with one address.
- **Get device info** does the same, and so now also asks the device for its
  own interface table. It still asks nothing about neighbours, ARP, MAC
  tables or routes, and contacts no other address.

## 2.17.0 — 2026-11-15

**Get device info: one device asked what it is, with no crawl**
- Right-click a device and choose **Get device info**. Its model, every
  chassis serial, software, hostname, base MAC and stack members are read
  from the device and written into its fields — what an as-built needs.
- It is separate from discovery and nothing like a crawl: one login to that
  device's own address, with its own login or the project's. It is asked its
  version, what its platform needs to state a model and serial, and its
  stack table. It is never asked about neighbours, ARP, MAC tables or
  routes, no other address is contacted, and nothing is written to it.
- The status line lists every command that was sent.
- What the device does not answer keeps what was typed; the display name is
  never changed. SSH only.

## 2.16.0 — 2026-11-15

**A saved password cannot be read back, anywhere**
- The eye beside a saved login is gone, and so is the command behind it. A
  password, community or key is visible while it is typed and at no other
  time. To check one, replace it.
- Saved secrets were already encrypted on disk and still are. What changes
  is that nothing in the application can ask for one in the clear.
- A firewall's API login could end up inside an error message when its
  request failed — kept in the run's log and shown on the Collect tab. The
  address is now taken off such an error and the log is redacted before it
  is kept.

**A project's logins and host keys are its own**
- The start screen no longer lists saved logins or SSH host keys. With no
  project open there is the vault's lock and passphrase, and nothing else.
- Each project lists its own logins and its own host keys under Settings,
  and can use no other project's. A login a project could use before the
  update is still there after it: where two projects used one login, each
  now has a copy of its own.
- A host key remembered for an address belongs to the projects whose
  diagram or crawl has that address. Two customers who both have a
  10.1.1.1 no longer share one remembered key for it.
- Logins that belong to no project — left by earlier versions, or by
  projects since deleted — are counted on the start screen with one
  button to delete them. They cannot be listed or used.
- A duplicated project starts with no saved logins.

**Nothing of one project reaches another**
- Closing a project ends its crawl, collection, backup and sweep, and
  clears what they found from the window. A run that finishes late reports
  to nobody; it used to be handed to the next project opened.
- What was copied from one project's diagram or racks is not pasteable into
  another.
- Deleting a project now deletes everything it had: its collection runs
  with every table read from the devices, its settings, its saved logins,
  its host keys, its login-use log, its crash-recovery copy, and the
  diagnostics and logs its runs wrote. Those files are kept in a folder per
  project from now on.
- While a project is open, the backend refuses a request for another
  project's events, runs, backups or settings.

**Smaller**
- Diagnostics, debug logs, login transcripts, terminal session logs and
  Meraki backups are readable by their owner alone on Linux and macOS.
- A support capture redacts saved SNMP logins and per-device logins as well
  as the run's own.
- Exporting a project's logins needs the vault unlocked.

**Not changed, and worth knowing**
- Diagnostics and logs written by earlier versions are in one folder for
  the machine (`diagnostics`, `logs`, `logins` under the application's data
  folder). They are not attributed to a project and are left where they
  are; delete them by hand if they are no longer needed.

## 2.15.3 — 2026-11-15

**A Nexus is read in its own words**
- A crawl asks a Nexus for its bundles with `show port-channel summary` and
  reads NX-OS's table, wrapped member lists included. It used to ask
  `show etherchannel summary`, which NX-OS rejects, so no bundle was drawn.
- Trunks and port status are asked as `show interface trunk` and
  `show interface status` — NX-OS rejects the plural — and the trunk table
  is read in NX-OS's layout, with each trunk's native VLAN and the VLANs it
  carries.
- The ARP table is asked for every VRF. `show ip arp` alone is the default
  VRF's, which on a switch managed through `mgmt0` is often empty.
- A learned MAC entry keeps its VLAN: NX-OS puts a marker column in front
  of it.
- Read against real NX-OS output and against the sample output in Cisco's
  Nexus 9000 (NX-OS 9.3) and Nexus 7000 references. Not yet checked against
  a capture from a switch of yours.

## 2.15.2 — 2026-11-15

**The dock in a window of its own**
- A new button on the dock, *Open in its own window*, moves the whole dock —
  monitored objects, events, backups, the terminal with its open sessions,
  and the rest — into a second window, so the diagram keeps the main one.
  Put it on another screen. It is the same dock, drawn from the same
  project in memory: nothing is copied and nothing can fall out of step.
  The same button there, or closing that window, brings it back.

**SSH through a neighbour**
- A device this computer cannot route to opens from its right-click menu's
  *SSH through* a linked device: Corelens logs in to the neighbour, runs
  that device's own `ssh` to the target with the same login, and the
  session is an ordinary terminal tab.

**SSH to older switches**
- A device that offers only the MAC `hmac-sha1-96` can be reached. The
  connection used to end at the key exchange with *No common Mac algorithm*.
  It is offered last, so a device that has anything newer still uses that.

**Releases**
- A release carries one `SHA256SUMS.txt` for everything in it that is
  downloaded and run: the Windows installer, the macOS disk image and the
  macOS update archive.

**Canvas**
- One element fewer per link: a hit path that duplicated two others is gone.
  Pointing at and clicking a link are as they were.

**Under the bonnet**
- The build tools are past their published advisories (`npm audit`: none),
  and CI builds on Node 22.

## 2.15.1 — 2026-11-14

**The canvas is easier on the eye**
- Both grounds are softer. The dark one is a slate page on a charcoal desk
  instead of near-black; the light one is a warm off-white page with soft
  black ink instead of pure white and pure black. High contrast and print
  are as they were.
- A device's name and address were haloed in the desk's colour while
  standing on the page — a brown glow round every label on the light
  ground. The halo is the page's colour now.

**Boxes behind devices**
- A filled box sent to the back is under the links as well as the devices,
  on screen and in the SVG, PNG and PDF exports. It used to cover the links.
- A name, an address, a port label or a link label on a filled box is
  written in ink chosen for that fill, with a halo in the fill's colour, on
  screen and in the exports. A box's own text does the same on its own fill.
- *Box around the selection*, on the right-click menu, draws a box sized to
  the selected devices and puts it behind everything, in one undo step.

**As-built workbook**
- *Export → As-built workbook (Excel)* writes one `.xlsx` with a tab each
  for devices, links, ports, VLANs and addresses. The header row is bold and
  stays in view; anything typed like a formula is kept as text.

**Importing an inventory**
- A heading row over each site's devices names their site, and each site
  arrives in a titled frame of its own.
- A column naming the device each row connects to becomes links.
- Rack position can be given as the top rack unit and a height; the lowest
  unit is worked out. `U12` and `12U` read as 12.

**Terminal**
- *Copy on select* and saving the session log are on to begin with. A
  choice already made on this computer is kept. The log is written only
  where a configuration folder has been chosen.

**Fixed**
- A project package in the older single-page shape opened to a broken
  canvas.
- A link's tooltip element is made when the link is pointed at, not kept
  for every link on the page.

## 2.15.0 — 2026-11-14

**Device details for an as-built**
- *Export → Device details for as-builts (CSV)* writes one row per device,
  by site and then by name: name, hostname, type, role, vendor, model, serial
  number, asset tag, software, management IP and every other address, MAC,
  site, rack and rack unit, stack members, ports in use, VLANs, what it is
  cabled to with both ports, when it was last read, and its notes. Boxes,
  zones and text are left out. It follows the *Pages* choice at the top of
  the menu, like the other tables.

## 2.14.0 — 2026-11-12

**Links meet a device on its ring**
- A link ends on the ring round a device — the circle that marks it selected
  — and the four connection dots sit on the same ring. It used to end inside
  the ring, on the drawing, where its end handle was under the device and
  could not be picked up.
- Several links on one side of a device share the side out instead of all
  leaving from one point: side by side, in the order of where they go, so
  two links between the same pair run parallel and a fan does not cross
  itself on the way out.
- Dragging a link's end slides it round the ring, easing onto the top, the
  sides and the diagonals; it stays where it is let go. Dropped on another
  device, it lands on that device's ring. An end placed on an older version
  is shown on the ring, on the same bearing.
- A new link can be let go anywhere on a device, not only on a dot.

**Orthogonal links are drawn square, on tracks of their own**
- Step, smooth-step and auto links run in right angles only. The slanted
  runs are gone: they came from parallel links being shifted into lanes, and
  from a hand-bent route whose devices had since moved.
- Links whose middle runs would lie on the same line between two tiers each
  take a parallel track, ordered so a link does not cross a neighbour it has
  no need to.
- Devices on different tiers are joined top to bottom, however far across
  they are; a link no longer leaves by the side and runs through the other
  devices on its own tier.
- An auto link goes round a note or device that sits close to one of its
  ends, instead of straight through it.
- The export draws links from the same layout as the canvas, including a
  route bent by hand, which it used to ignore.

**Faster, most of all while monitoring**
- Probe results are applied in batches, and a device or link listens only to
  its own probe. Each result used to re-render every device, every link and
  the panels. On a 154-device, 231-link diagram with every probe answering:
  idle went from 109 ms a frame to 16.7, panning from 133 to 11, dragging a
  device from 135 to 7.
- The dots travelling along live links are drawn on one canvas instead of as
  six animated SVG elements a link.
- Dragging a device re-renders the links at it once a frame, not four times,
  and no longer re-renders every link with a port label when it is let go.
- Line hops are worked out for diagrams of up to 1,200 links (it was 160).
- With no checks running, dragging a device on that diagram takes half the
  time it did in 2.13.0. Panning no longer redraws the overview map and the
  toolbar at every step, and the drawing is slid as one layer while it is
  dragged about; zooming redraws the zoom figure and nothing else of the
  strip. Panning a large diagram is still the slowest thing the canvas does.

**Fixed**
- *Send to back* and *Send backward* showed nothing on the object they
  were used on: a selected object was drawn above everything for as long as
  it stayed selected, so the change appeared only after clicking away. A
  selected object now keeps its place in the stack.
- *Project package* and *Project as a folder* failed, with nothing saved, on
  a project last saved before pages existed. The stored project is brought
  up to date before it is exported.

**Security updates in the backend**
- The libraries behind constant-time arithmetic and the project database
  are updated to the releases that fix the advisories published in late
  October: `crypto-bigint`, `ctutils` and SQLite (through `rusqlite` 0.41).
  The update checker moves to `tauri-plugin-updater` 2.14, which reads
  update archives with the fixed `zip`, and Tauri to 2.12. Building from
  source now needs Rust 1.90 or later.
- The SSH library moves to `russh` 0.65 for an advisory in its agent
  server, a part Corelens does not use.

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
