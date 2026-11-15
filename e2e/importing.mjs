// Import and export, driven through the real app with the Tauri bridge stubbed
// (Phase 5): Visio bends and label formatting, draw.io, a
// spreadsheet with its columns matched by hand, saved SNMP walks,
// NetBox and Nmap; Visio and draw.io files of every
// page, PDF of every page, the table CSVs,
// the report with its drawings, the interactive HTML page and
// a project as a folder.
// Invented names, documentation addresses.
//
//     npm run dev            # in another terminal
//     node e2e/importing.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const dev = (id, label, x, address, extra = {}) => ({
  id, type: "device", position: { x, y: 0 }, width: 76, height: 76,
  data: { label, deviceType: "access-switch", tags: [], locked: false, maintenance: false, showDetails: true,
    addresses: address ? [{ id: `${id}-a`, label: "Management", address, isPrimary: true }] : [], ...extra },
});
const canvas = { gridEnabled: true, snapEnabled: true, minimap: false, nodeStyle: "glyph" };
const project = {
  meta: { id: "importing", name: "Import lab", createdAt: NOW, updatedAt: NOW },
  documentVersion: 1,
  document: {
    activePageId: "p1",
    probes: [{ id: "pr1", projectId: "importing", objectKind: "node", objectId: "a", name: "Ping", kind: "icmp", target: "192.0.2.10", intervalSeconds: 5, timeoutMs: 1000, failureThreshold: 3, recoveryThreshold: 2, enabled: true, maintenance: false, isPrimary: true }],
    pages: [
      { id: "p1", name: "Core", canvas, nodes: [
          dev("a", "CORE-SW1", 0, "192.0.2.10", { serial: "FOC0000X0AA", inventory: { collectedAt: NOW, routes: [], spanningTree: [], vlans: [{ id: 10, name: "STAFF" }], ports: [{ port: "Gi0/1", status: "connected", mode: "access", vlan: 10 }] } }),
          dev("b", "EDGE-RTR1", 300, "192.0.2.1"),
        ],
        edges: [{ id: "ab", source: "a", target: "b", type: "live", data: { sourcePortLabel: "Gi0/1", targetPortLabel: "Gi0/0", label: "", enabled: true, maintenance: false, waypoints: [{ x: 40, y: 150 }, { x: 340, y: 150 }], healthRule: { type: "manual", manualStatus: "healthy" } } }] },
      { id: "p2", name: "Branch", canvas, nodes: [dev("c", "BR-SW1", 0, "198.51.100.2")], edges: [] },
    ],
  },
};

const walkDevice = {
  hostname: "ACCESS-SW7", address: "192.0.2.7", addresses: [{ ip: "192.0.2.7", interface: "Vl1", isManagement: true }], probeTarget: "192.0.2.7",
  class: "switch", platform: "WS-C2960CX-8PC-L", serial: "FOC0000X0BB", version: "Cisco IOS Software", hops: 0, reachedBy: "snmp",
  neighbors: [{ deviceId: "EDGE-SW2", shortName: "EDGE-SW2", addresses: [{ ip: "192.0.2.112", interface: null, isManagement: true }], localInterface: "Gi0/1", remoteInterface: "Port 4", platform: null, capabilities: ["Bridge"], version: "USW-Lite-8", class: "switch", discoveredBy: "lldp", serial: null, chassisId: "00:00:5e:00:53:a8", vendor: null }],
  attached: [], portChannels: [], routes: [], spanningTree: [], vlans: [], portVlans: [], ports: [],
};

const drawing = {
  pages: [{ name: "Page-1", devices: [
      { id: "1", label: "DRAWN-RTR", addresses: ["192.0.2.201"], deviceType: "router", model: "router", properties: {}, x: 1, y: -1, width: 0.6, height: 0.6, labelStyle: { bold: true, italic: false, size: 12, color: "#ff0000", align: "left" } },
      { id: "2", label: "DRAWN-SW", addresses: [], deviceType: "l3-switch", model: "switch", properties: {}, x: 4, y: -3, width: 0.6, height: 0.6, labelStyle: null },
    ], links: [{ source: "1", target: "2", label: "", sourcePort: "Gi0/0", targetPort: "Gi1/0/1", glued: true, color: "#0070c0", waypoints: [[1, -3]] }] }],
  warnings: ["Page-1: 2 lines not joined to two shapes were left out."],
};

const netbox = JSON.stringify({ devices: [
  { name: "NB-CORE1", device_type: { model: "C9500-24Y4C", manufacturer: { name: "Cisco" } }, role: { name: "Core Switch" }, site: { name: "Lab" }, rack: { name: "R01" }, position: 40, primary_ip4: { address: "192.0.2.50/24" }, serial: "NB0001", tags: [] },
  { name: "NB-FW1", device_type: { model: "FG-100F", manufacturer: { name: "Fortinet" } }, role: { name: "Firewall" }, site: { name: "Lab" }, primary_ip4: { address: "192.0.2.51/24" }, tags: [] },
], cables: [{ id: 1, label: "C-1", a_terminations: [{ object_type: "dcim.interface", object: { device: { name: "NB-CORE1" }, name: "Te1/0/1" } }], b_terminations: [{ object_type: "dcim.interface", object: { device: { name: "NB-FW1" }, name: "port1" } }] }] });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.addInitScript(({ p, walkDevice, drawing, netbox }) => {
  const listeners = {}, callbacks = {};
  let next = 1;
  window.__calls = [];
  window.__exports = [];
  window.__picked = null;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) { const id = next++; callbacks[id] = cb; return id; },
    invoke(cmd, args) {
      if (cmd === "plugin:event|listen") { listeners[args.event] = args.handler; return Promise.resolve(next++); }
      window.__calls.push({ cmd, args });
      const meta = { id: p.meta.id, name: p.meta.name, customer: "", site: "", ticket: "", engineer: "", description: "", created_at: p.meta.createdAt, updated_at: p.meta.updatedAt, archived: false };
      if (cmd === "list_projects") return Promise.resolve([meta]);
      if (cmd === "load_project") {
        // The project as given when it is opened; what is on screen after that.
        const document = window.__opened ? window.__cvStore.getState().doc : p.document;
        window.__opened = true;
        return Promise.resolve({ meta, document_version: p.documentVersion, document });
      }
      if (cmd === "get_settings") return Promise.resolve({});
      if (cmd === "vault_status") return Promise.resolve({ exists: true, unlocked: true, credentials: 0, minimumPassphrase: 12 });
      if (cmd === "plugin:dialog|open") return Promise.resolve(window.__picked);
      if (cmd === "plugin:dialog|save") return Promise.resolve(`/tmp/${args.options?.defaultPath ?? "out"}`);
      if (cmd === "pick_export_target") return Promise.resolve({ token: `t-${next++}`, path: args.folder ? `${args.folder}/${args.filename}` : `/tmp/${args.filename}` });
      if (cmd === "pick_export_folder") return Promise.resolve({ token: `f-${next++}`, path: args.folder ?? "/tmp/picked" });
      if (cmd === "save_export") {
        const bytes = Uint8Array.from(atob(args.contentsB64), (c) => c.charCodeAt(0));
        window.__exports.push({ path: args.path, text: new TextDecoder().decode(bytes) });
        return Promise.resolve(null);
      }
      if (cmd === "describe_subnet") return Promise.resolve({ network: "192.0.2.0", broadcast: "192.0.2.255", prefix: 24, hosts: 254 });
      if (cmd === "read_snmp_walk") return Promise.resolve({ device: walkDevice, rows: 80, unknownNames: ["SNMPv2-MIB::sysORDescr"], unknownRows: 12, problems: [] });
      if (cmd === "read_nmap_xml") return Promise.resolve({ scanned: 10, up: 2, args: "nmap -sT", hosts: [
        { ip: "192.0.2.5", rttMs: 0.18, hostname: "nas1.example.test", nameSource: "dns", mac: null, vendor: null, ports: [{ port: 22, service: "ssh" }], serial: null, product: "OpenSSH", webServer: null, webTitle: null },
        { ip: "192.0.2.9", rttMs: 3.8, hostname: null, nameSource: null, mac: "00:00:5e:00:53:09", vendor: "ICANN, IANA Department", ports: [{ port: 22, service: "ssh" }, { port: 80, service: "http" }], serial: null, product: "Cisco SSH", webServer: "Cisco IOS http config", webTitle: null },
      ] });
      // An inventory kept by site: a heading row over each site's devices,
      // the top rack unit and a height, and the device each one hangs off.
      if (cmd === "read_spreadsheet" && /by-site/.test(args.path)) return Promise.resolve([
        { name: "Inventory", rows: [
          ["Hostname", "Mgmt IP", "Rack", "Top RU", "Height", "Management device"],
          ["North hall"],
          ["BS-CORE-1", "192.0.2.71", "R01", "20", "2", ""],
          ["BS-ACC-1", "192.0.2.72", "R01", "18", "1", "BS-CORE-1"],
          ["South hall"],
          ["BS-ACC-2", "192.0.2.73", "R07", "12", "", "BS-CORE-1"],
        ] },
      ]);
      if (cmd === "read_spreadsheet") return Promise.resolve([
        { name: "Title", rows: [["Inventory"]] },
        { name: "Devices", rows: [["Lab inventory, level 2"], ["Hostname", "Mgmt IP", "Backup IP", "Location", "Cabinet"], ["XL-SW1", "192.0.2.61", "198.51.100.61", "Lab", "R02"], ["XL-SW2", "192.0.2.62", "198.51.100.62", "Lab", "R02"]] },
      ]);
      if (cmd === "read_import") return Promise.resolve(netbox);
      if (cmd === "import_drawio") return Promise.resolve(drawing);
      if (cmd === "diagram_pdf_pages" || cmd === "diagram_pdf" || cmd === "diagram_vsdx") return Promise.resolve([37, 80, 68, 70]);
      if (cmd === "save_project_folder") return Promise.resolve(`${args.folder}/${args.name}`);
      if (cmd === "save_project") return Promise.resolve(null);
      return Promise.resolve([]);
    },
  };
}, { p: project, walkDevice, drawing, netbox });
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(800);

const st = (fn, arg) => page.evaluate(fn, arg);
const allNodes = () => st(() => window.__cvStore.getState().doc.pages.flatMap((pg) => pg.nodes));
const nodeByLabel = async (label) => (await allNodes()).find((n) => n.data.label === label);
const calls = (cmd) => st((cmd) => window.__calls.filter((c) => c.cmd === cmd), cmd);

// Compare, Racks and the two imports left the bottom panel for a
// screen of their own. Opening one is a button on the toolbar and then a tab,
// so this says which of the two a name is and goes to the right place.
// Racks is a screen on the rail, Compare a tab in the dock's Monitor group,
// and the two imports the Import dialog's two sources; this goes to the
// right place for a name.
const IMPORTS = { "From a file": "csv", "From a drawing": "visio" };
const openTab = async (name) => {
  const dialog = page.locator('[data-region="import-dialog"]');
  if (IMPORTS[name]) {
    if (!(await dialog.count())) {
      await page.locator('[data-region="import"]').first().click();
      await page.waitForTimeout(250);
    }
    const both = dialog.locator(".cv-import-head .cv-link-btn");
    if (await both.count()) {
      await both.click();
      await page.waitForTimeout(150);
    }
    await dialog.locator(`[data-source="${IMPORTS[name]}"]`).click();
    await page.waitForTimeout(250);
    return;
  }
  if (await dialog.count()) {
    await dialog.locator(".cv-import-close").click();
    await page.waitForTimeout(200);
  }
  if (name === "Racks") {
    await page.locator(".cv-nav-item", { hasText: /^Racks$/ }).click();
    await page.waitForTimeout(250);
    return;
  }
  if (await page.locator(".cv-tools").count()) {
    await page.locator(".cv-tools .cv-crumb-home").first().click();
    await page.waitForTimeout(250);
  }
  await page.locator(".cv-panel .cv-tabs button", { hasText: name === "Compare" ? "Compare runs" : name }).first().click();
};
const tab = openTab;
// Whichever of the two is in front: the screen when it is open, the panel
// otherwise. The screen is rendered before the workspace, so `.first()` picks
// it while it is there.
const panel = page.locator(".cv-import-body, .cv-tools .cv-screen-body, .cv-panel").first();
const exported = () => st(() => window.__exports);
const clearExports = () => st(() => { window.__exports = []; });

// ------------------------------------------------------ SNMP walks
await tab("Discover devices");
await page.waitForTimeout(300);
await panel.getByLabel("Open SNMP walk files").setInputFiles([{ name: "access-sw7.txt", mimeType: "text/plain", buffer: Buffer.from("SNMPv2-MIB::sysName.0 = STRING: ACCESS-SW7\n") }]);
await page.waitForTimeout(500);
const walkCall = (await calls("read_snmp_walk"))[0];
check("a saved walk is read by the backend as text", walkCall?.args.text.includes("sysName"), JSON.stringify(walkCall?.args));
check("its device and the neighbour it reports land in the table", (await panel.locator("tr", { hasText: "ACCESS-SW7" }).count()) === 1 && (await panel.locator("tr", { hasText: "EDGE-SW2" }).count()) === 1);
check("and what the walk could not use is said", /12 rows named by MIBs this does not read/.test(await panel.locator(".cv-discover-problem").textContent()));
await panel.locator("button", { hasText: /^Add \d+/ }).click();
await page.waitForTimeout(300);
await panel.locator("button", { hasText: /^Apply \d+ change/ }).click();
await page.waitForTimeout(400);
const walked = await nodeByLabel("ACCESS-SW7");
check("and reviewed onto the diagram like a crawl", walked && walked.data.serial === "FOC0000X0BB", JSON.stringify(walked?.data));

// ------------------------------------------------------- Nmap XML
await tab("Ping sweep");
await page.waitForTimeout(300);
await panel.getByLabel("Open an Nmap XML report").setInputFiles([{ name: "scan.xml", mimeType: "text/xml", buffer: Buffer.from("<nmaprun/>") }]);
await page.waitForTimeout(500);
check("an Nmap report fills the sweep's rows", (await panel.locator("tr", { hasText: "192.0.2.9" }).count()) === 1 && /2 hosts up in scan\.xml \(of 10 scanned\)/.test(await panel.textContent()), (await panel.textContent()).slice(0, 300));
await panel.locator("button", { hasText: /^Add 2 to diagram/ }).click();
await page.waitForTimeout(400);
const nas = (await allNodes()).find((n) => n.data.addresses?.[0]?.address === "192.0.2.5");
check("and its hosts are added as a sweep's would be", nas && /nas1/.test(nas.data.label + (nas.data.hostname ?? "")), JSON.stringify(nas?.data));

// ------------------------------------------------ spreadsheet mapping
await tab("From a file");
await page.waitForTimeout(300);
await st(() => { window.__picked = "/home/user/inventory.xlsx"; });
await panel.locator("button", { hasText: "Choose a file" }).click();
await page.waitForTimeout(400);
const mapper = panel.locator(".cv-import-map");
check("a workbook opens on its first sheet with rows", (await mapper.getByLabel("Column for Name").count()) === 1 || (await panel.locator("select").first().count()) === 1);
await mapper.locator("select").first().selectOption({ label: "Devices" });
await page.waitForTimeout(200);
check("the title line above the table is passed over", (await mapper.locator('input[type="number"]').inputValue()) === "2");
check("columns are matched from their own names", (await mapper.getByLabel("Column for Name").inputValue()) === "0" && (await mapper.getByLabel("Column for Address").inputValue()) === "1" && (await mapper.getByLabel("Column for Rack").inputValue()) === "4");
await mapper.getByLabel("Column for Address").selectOption({ label: "Backup IP" });
await page.waitForTimeout(200);
check("and a guess can be changed before anything is added", (await panel.locator("td", { hasText: "198.51.100.61" }).count()) === 1);
await panel.locator("button", { hasText: /^Add 2 to diagram/ }).click();
await page.waitForTimeout(400);
const xl = await nodeByLabel("XL-SW1");
check("the rows arrive with the mapped fields", xl?.data.addresses?.[0]?.address === "198.51.100.61" && xl.data.site === "Lab" && xl.data.rack === "R02", JSON.stringify(xl?.data));

// ------------------------------------------- an inventory kept by site
await st(() => { window.__picked = "/home/user/by-site.xlsx"; });
await panel.locator("button", { hasText: "Choose a file" }).click();
await page.waitForTimeout(400);
check("top rack unit, height and the device it connects to are matched from their headers",
  (await mapper.getByLabel("Column for Top rack unit").inputValue()) === "3" && (await mapper.getByLabel("Column for Height (U)").inputValue()) === "4" &&
    (await mapper.getByLabel("Column for Connects to").inputValue()) === "5");
check("the heading rows and the links to come are said before anything is added",
  /2 heading rows \("North hall", …\)/.test(await panel.textContent()) && /2 rows name a device they connect to/.test(await panel.textContent()), (await panel.textContent()).slice(0, 400));
{
  const edgesBefore = await st(() => window.__cvStore.getState().doc.pages.flatMap((pg) => pg.edges).length);
  await panel.locator("button", { hasText: /^Add 3 to diagram/ }).click();
  await page.waitForTimeout(500);
  const core = await nodeByLabel("BS-CORE-1");
  const acc1 = await nodeByLabel("BS-ACC-1");
  const acc2 = await nodeByLabel("BS-ACC-2");
  check("each device takes the heading above it as its site", core?.data.site === "North hall" && acc1?.data.site === "North hall" && acc2?.data.site === "South hall",
    JSON.stringify([core?.data.site, acc1?.data.site, acc2?.data.site]));
  check("a 2U device with its top at 20 starts at 19, and a 1U one at 18 stays there", core?.data.rackU === 19 && core.data.rackUnits === 2 && acc1?.data.rackU === 18,
    JSON.stringify([core?.data.rackU, core?.data.rackUnits, acc1?.data.rackU]));
  check("a top unit with no height in the sheet uses the device's own height", acc2?.data.rackU === 12 - (acc2.data.rackUnits ?? 1) + 1, JSON.stringify([acc2?.data.rackU, acc2?.data.rackUnits]));
  const edges = await st(() => window.__cvStore.getState().doc.pages.flatMap((pg) => pg.edges));
  const linked = (a, b) => edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
  check("the connects-to column becomes links", edges.length === edgesBefore + 2 && linked(acc1.id, core.id) && linked(acc2.id, core.id));
  const zones = (await allNodes()).filter((n) => n.data.deviceType === "zone" && ["North hall", "South hall"].includes(n.data.label));
  const inside = (z, n) => z.position.x < n.position.x && z.position.y < n.position.y && z.position.x + z.width > n.position.x + (n.width ?? 0) && z.position.y + z.height > n.position.y + (n.height ?? 0);
  const north = zones.find((z) => z.data.label === "North hall");
  const south = zones.find((z) => z.data.label === "South hall");
  check("each site gets a titled frame round its own devices and no one else's",
    zones.length === 2 && inside(north, core) && inside(north, acc1) && !inside(north, acc2) && inside(south, acc2) && !inside(south, core),
    JSON.stringify(zones.map((z) => [z.data.label, z.position, z.width, z.height])));
  check("and the frames do not overlap", north && south && (north.position.y + north.height <= south.position.y || south.position.y + south.height <= north.position.y));
  check("the result says so", /Added 3 devices in 2 sites.*Added 2 links/.test(await panel.textContent()), (await panel.textContent()).slice(0, 300));
}

// ------------------------------------------------------------ NetBox
await st(() => { window.__picked = "/home/user/netbox.json"; });
await panel.locator("button", { hasText: "Choose a file" }).click();
await page.waitForTimeout(400);
check("a NetBox export is previewed as devices and cables", /2 devices and 1 cable from NetBox/.test(await panel.textContent()));
await panel.locator("button", { hasText: /^Add 3 to diagram/ }).click();
await page.waitForTimeout(400);
const nb = await nodeByLabel("NB-CORE1");
check("with role, site, rack and position", nb?.data.deviceType === "core-switch" && nb.data.rack === "R01" && nb.data.rackU === 40 && nb.data.serial === "NB0001", JSON.stringify(nb?.data));
const nbEdge = await st(() => window.__cvStore.getState().doc.pages[0].edges.find((e) => e.data?.sourcePortLabel === "Te1/0/1"));
check("and the cable between them", nbEdge?.data.targetPortLabel === "port1", JSON.stringify(nbEdge));

// ------------------------------------------------ a drawing
await tab("From a drawing");
await page.waitForTimeout(300);
await st(() => { window.__picked = "/home/user/network.drawio"; });
await panel.locator("button", { hasText: "Choose a drawing" }).click();
await page.waitForTimeout(500);
check("a draw.io drawing is read by its own reader", (await calls("import_drawio")).length === 1 && (await calls("import_visio")).length === 0);
check("and previewed with what it left out", /not joined to two shapes/.test(await panel.textContent()));
await panel.locator("button", { hasText: "Add to diagram" }).click();
await page.waitForTimeout(500);
const drawn = await nodeByLabel("DRAWN-RTR");
check("a drawn label keeps its formatting", drawn?.data.labelStyle?.bold === true && drawn.data.labelStyle.color === "#ff0000" && drawn.data.labelStyle.size === 16, JSON.stringify(drawn?.data.labelStyle));
const drawnEdge = await st(() => window.__cvStore.getState().doc.pages.flatMap((pg) => pg.edges).find((e) => e.data?.sourcePortLabel === "Gi0/0" && e.data?.targetPortLabel === "Gi1/0/1"));
check("and a routed line keeps its bend", drawnEdge?.data.waypoints?.length === 1 && drawnEdge.data.pathType === "step", JSON.stringify(drawnEdge?.data));

// ------------------------------------------------------------- exports
await st(() => window.__cvStore.getState().setActivePage?.("p1"));
await page.waitForTimeout(300);
const menu = page.locator(".cv-dropdown").filter({ has: page.locator("summary", { hasText: "Export" }) });
const exportButton = async (name) => {
  await menu.locator("summary").click();
  await page.waitForTimeout(150);
  await menu.locator("button", { hasText: name }).first().click();
  await page.waitForTimeout(600);
};
await menu.locator("summary").click();
await page.waitForTimeout(150);
const pagesCount = await st(() => window.__cvStore.getState().doc.pages.length);
await menu.getByLabel("Pages to export").selectOption("all");
await menu.locator("summary").click();

await clearExports();
await exportButton("Diagram for draw.io");
const drawio = (await exported())[0]?.text ?? "";
check("draw.io gets every page in one file", (drawio.match(/<diagram /g) ?? []).length === pagesCount && drawio.includes('name="Branch"'), drawio.slice(0, 200));
check("with links glued, their bends and ports kept", /source="a" target="b" edge="1"/.test(drawio) && drawio.includes('<mxPoint x="40" y="150"/>') && drawio.includes("Gi0/1 &lt;&gt; Gi0/0"));

await exportButton("Diagram for Visio");
const vsdx = (await calls("diagram_vsdx")).at(-1)?.args.drawing;
check("Visio gets every page, with each link's bends", vsdx?.pages.length === pagesCount && vsdx.pages[0].links.some((l) => l.points.length === 2), JSON.stringify(vsdx?.pages?.[0]?.links));

// "This page": the tables and the package narrow to the open page, not
// only the drawings.
await menu.locator("summary").click();
await page.waitForTimeout(150);
await menu.getByLabel("Pages to export").selectOption("page");
await menu.locator("summary").click();
await clearExports();
await exportButton("Devices and links as CSV");
const onePageDevices = (await exported()).map((e) => e.text).join("\n");
check("This page: the devices CSV lists the open page's devices only", onePageDevices.includes("CORE-SW1") && !onePageDevices.includes("BR-SW1"), onePageDevices.slice(0, 160));
await clearExports();
await exportButton("Project package (.corelens)");
const onePageText = (await exported())[0]?.text ?? "";
const onePage = onePageText ? JSON.parse(onePageText) : null;
const onCore = new Set([...(onePage?.document?.pages?.[0]?.nodes ?? []).map((n) => n.id), ...(onePage?.document?.pages?.[0]?.edges ?? []).map((e) => e.id)]);
check("and a package exported with This page is a one-page project, with that page's probes only",
  onePage?.document?.pages?.length === 1 && onePage.document.pages[0].name === "Core" && onePage.document.activePageId === "p1" && onePage.document.probes.length > 0 && onePage.document.probes.every((p) => onCore.has(p.objectId)),
  JSON.stringify({ pages: onePage?.document?.pages?.map((p) => p.name), probes: onePage?.document?.probes?.length }));
await menu.locator("summary").click();
await page.waitForTimeout(150);
await menu.getByLabel("Pages to export").selectOption("all");
await menu.locator("summary").click();

await exportButton("Diagram as PDF");
const pdf = (await calls("diagram_pdf_pages")).at(-1)?.args.svgs;
check("a PDF of every page is one document of pages", pdf?.length === pagesCount && pdf.every((s) => s.includes("<svg")));

await clearExports();
await exportButton("Ports as CSV");
await exportButton("VLANs as CSV");
await exportButton("Probe results as CSV");
const csvs = await exported();
check("ports, VLANs and probe results come out as CSV", csvs.length === 3 && csvs[0].text.includes("CORE-SW1,Core,Gi0/1") && csvs[1].text.includes("10,STAFF,CORE-SW1") && csvs[2].text.includes("CORE-SW1,Ping,icmp,192.0.2.10"), JSON.stringify(csvs.map((c) => c.text.slice(0, 120))));

await clearExports();
await exportButton("Device details for as-builts (CSV)");
const asBuilt = (await exported())[0];
const asBuiltRows = (asBuilt?.text ?? "").trim().split("\n");
check("device details for an as-built come out as one row per device",
  asBuiltRows[0]?.startsWith("Device,Hostname,Type,Role,Vendor,Model,Serial number") && asBuiltRows.some((r) => r.startsWith("CORE-SW1,")) && asBuiltRows.filter((r) => r.startsWith("CORE-SW1,")).length === 1,
  JSON.stringify({ name: asBuilt?.name, head: asBuiltRows.slice(0, 2) }));

await clearExports();
await exportButton("As-built workbook (Excel)");
const workbook = (await exported())[0];
check("the as-built workbook comes out as one Excel file with a tab per table",
  (await calls("pick_export_target")).some((c) => /-as-built\.xlsx$/.test(c.args?.filename ?? "")) && workbook?.text.startsWith("PK") &&
    ["Devices", "Links", "Ports", "VLANs", "Addresses"].every((n) => workbook.text.includes(`<sheet name="${n}"`)) && workbook.text.includes(">CORE-SW1<"),
  JSON.stringify({ asked: (await calls("pick_export_target")).map((c) => c.args?.filename).slice(-2), head: workbook?.text.slice(0, 4) }));

await clearExports();
await exportButton("Validation report (Markdown)");
const md = (await exported())[0]?.text ?? "";
check("the report carries each page's drawing", (md.match(/!\[[^\]]*\]\(data:image\/svg\+xml;base64,/g) ?? []).length === pagesCount && md.includes("### Branch"));

await clearExports();
await exportButton("Interactive HTML page");
const html = (await exported())[0]?.text ?? "";
check("the HTML page is one self-contained file", html.startsWith("<!doctype html>") && (html.match(/role="tab"/g) ?? []).length === pagesCount && !/(src|href)="https?:/.test(html));
const viewer = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const offline = [];
viewer.on("request", (r) => { if (!r.url().startsWith("data:") && !r.url().startsWith("about:")) offline.push(r.url()); });
viewer.on("pageerror", (e) => console.log("HTML PAGE EXCEPTION:", String(e).slice(0, 300)));
await viewer.setContent(html, { waitUntil: "load" });
await viewer.waitForTimeout(300);
const box = await viewer.locator('.stage:not([hidden]) [data-node="a"]').boundingBox();
await viewer.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await viewer.waitForTimeout(200);
if (process.env.SHOT) await viewer.screenshot({ path: process.env.SHOT });
check("and a click on a device opens its details", (await viewer.locator("#details h2").textContent()) === "CORE-SW1" && /FOC0000X0AA/.test(await viewer.locator("#details").textContent()));
await viewer.locator("#search").fill("198.51.100.2");
await viewer.waitForTimeout(150);
await viewer.locator("#results button", { hasText: "BR-SW1" }).click();
await viewer.waitForTimeout(200);
check("search finds a device on another page and goes to it", (await viewer.locator('[role=tab][aria-selected="true"]').textContent()) === "Branch" && (await viewer.locator("#details h2").textContent()) === "BR-SW1");
check("nothing is fetched from anywhere", offline.length === 0, offline.join(", "));
await viewer.close();

await st(() => window.__cvStore.getState().setSettings({ exportFolder: "/home/user/exports" }));
await exportButton("Project as a folder");
// The folder goes to Rust's picker; the write names only the token it gave.
const pickedFolder = (await calls("pick_export_folder")).at(-1)?.args;
const folder = (await calls("save_project_folder")).at(-1)?.args;
check("a project saves as a folder of JSON and YAML", pickedFolder?.folder === "/home/user/exports" && typeof folder?.token === "string" && folder.token.startsWith("f-") && !("folder" in folder) && folder.name === "import-lab" && folder.json.startsWith("{") && folder.yaml.startsWith("# A readable copy") && !folder.json.includes('"vault"'), JSON.stringify(folder && { ...folder, json: folder.json.slice(0, 40), yaml: folder.yaml.slice(0, 60) }));

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
