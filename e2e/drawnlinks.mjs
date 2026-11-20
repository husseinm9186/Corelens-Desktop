// Fill in drawn links from the devices.
//
// A diagram drawn by hand is checked against the devices on it: each drawn
// device with an address and a login is asked who is on its ports, and
// nobody else is. Confirmed links take their ports and the colour of what
// the port is made of; a drawn link no device reports turns purple;
// management links are drawn sky blue and thinner and can be hidden; and
// nothing that is not on the page is put on it.
//
// The backend is a stand-in that answers `get_device_links` per address.
// What is real is the window: which addresses it asks, what it draws, and
// that no crawl is started. The matching rules are in `drawnLinks.test.ts`;
// the reading itself in `corelens-discover/src/devicelinks.rs`.
//
//     npm run dev
//     node e2e/drawnlinks.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const node = (id, label, x, y, address, over = {}) => ({
  id, type: "device", position: { x, y }, width: 76, height: 76,
  data: { label, deviceType: "core-switch", tags: [], sshCredentialId: "cred-1",
    addresses: address ? [{ id: `${id}-a`, label: "Mgmt", address, isPrimary: true }] : [], ...over },
});
const link = (id, source, target, over = {}) => ({
  id, source, target, sourceHandle: "b", targetHandle: "t", type: "live",
  data: { sourcePortLabel: "", targetPortLabel: "", label: "", pathType: "straight", direction: "none", width: 2,
    color: "#2fbf6b", enabled: true, maintenance: false, healthRule: { type: "manual", manualStatus: "unknown" }, ...over },
});

const project = {
  meta: { id: "drawn", name: "Drawn", customer: "", site: "", ticket: "", engineer: "",
    description: "", createdAt: NOW, updatedAt: NOW, archived: false },
  documentVersion: 1,
  document: {
    activePageId: "p1", probes: [],
    pages: [{ id: "p1", name: "Fabric",
      canvas: { gridEnabled: true, snapEnabled: true, minimap: false, nodeStyle: "glyph" },
      nodes: [
        node("sp", "SPINE-1", 300, 0, "192.0.2.5"),
        node("l1", "LEAF-1", 100, 300, "192.0.2.1"),
        node("l2", "LEAF-2", 500, 300, "192.0.2.2"),
        node("mg", "MGMT-SW", 800, 0, "192.0.2.100", { deviceType: "access-switch" }),
        // Drawn, with nothing to ask it by.
        node("fw", "FIREWALL", 800, 300, "", { deviceType: "firewall" }),
      ],
      edges: [
        link("s1", "sp", "l1"),            // confirmed, a QSFP
        link("s2", "sp", "l2"),            // confirmed, an SFP
        link("x", "l1", "l2"),             // drawn; no device reports it
        link("f", "l2", "fw"),             // LEAF-2 was asked and does not report it
      ] }],
  },
};

// What each device says. Invented, in the shape the backend returns.
const said = (name, local, remote, over = {}) => ({ deviceId: name, shortName: name, serial: null, addresses: [],
  localInterface: local, remoteInterface: remote, platform: null, capabilities: [], version: null, class: "switch",
  discoveredBy: "cdp", chassisId: null, vendor: null, ...over });
const ANSWERS = {
  "192.0.2.5": { neighbors: [said("LEAF-1", "Ethernet1/1", "Ethernet1/49"), said("LEAF-2", "Ethernet1/2", "Ethernet1/49"), said("MGMT-SW", "mgmt0", "GigabitEthernet1/0/5"), said("NOT-ON-THE-PAGE", "Ethernet1/9", "Ethernet1/1", { addresses: [{ ip: "192.0.2.77", interface: null, isManagement: true }] })],
    ports: [{ port: "Eth1/1", media: "QSFP-100G-SR4", speed: "100G" }, { port: "Eth1/2", media: "10Gbase-SR", speed: "10G" }] },
  "192.0.2.1": { neighbors: [said("SPINE-1", "Ethernet1/49", "Ethernet1/1"), said("MGMT-SW", "mgmt0", "GigabitEthernet1/0/1")], ports: [] },
  "192.0.2.2": { neighbors: [said("SPINE-1", "Ethernet1/49", "Ethernet1/2"), said("MGMT-SW", "mgmt0", "GigabitEthernet1/0/2")], ports: [] },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
await page.addInitScript(({ p, answers }) => {
  const listeners = {}, callbacks = {};
  let next = 1;
  window.__asked = [];   // every get_device_links payload
  window.__other = [];   // anything else that reaches a device
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) { const id = next++; callbacks[id] = cb; return id; },
    invoke(cmd, args) {
      if (cmd === "plugin:event|listen") { listeners[args.event] = args.handler; return Promise.resolve(next++); }
      const meta = { id: p.meta.id, name: p.meta.name, customer: "", site: "", ticket: "",
        engineer: "", description: "", created_at: p.meta.createdAt, updated_at: p.meta.updatedAt, archived: false };
      if (/^(start_|ssh_open|get_device_info|ping_from|traceroute_from|console_open|collection_live)/.test(cmd)) window.__other.push(cmd);
      if (cmd === "list_projects") return Promise.resolve([meta]);
      if (cmd === "load_project") return Promise.resolve({ meta, document_version: p.documentVersion, document: p.document });
      if (cmd === "vault_status") return Promise.resolve({ exists: true, unlocked: true, credentials: 1, minimumPassphrase: 12, keptInKeychain: true });
      if (cmd === "list_credentials") return Promise.resolve([{ id: "cred-1", label: "Lab", kind: "ssh", username: "ops", detail: "", hasSecondSecret: false }]);
      if (cmd === "get_device_links") {
        window.__asked.push(args);
        const a = answers[args.device];
        if (!a) return Promise.reject(`${args.device} refused the login`);
        return Promise.resolve({ hostname: "x", family: "Cisco NX-OS", serials: [], commands: ["show version"], unverified: false, ...a });
      }
      if (cmd === "get_settings") return Promise.resolve({});
      if (cmd === "save_project") return Promise.resolve();
      return Promise.resolve([]);
    },
  };
}, { p: project, answers: ANSWERS });

page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(900);

const st = (fn, arg) => page.evaluate(fn, arg);
const message = () => page.locator(".cv-panel-message").textContent().catch(() => "");
const edges = () => st(() => window.__cvStore.getState().doc.pages[0].edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...e.data })));
const paneMenu = async (text) => {
  const pane = await page.locator(".react-flow__pane").boundingBox();
  await page.mouse.click(pane.x + pane.width - 220, pane.y + pane.height - 160, { button: "right" });
  await page.waitForTimeout(300);
  return page.locator(".cv-context-menu button, .cv-menu button", { hasText: text }).first();
};
const strokeOf = (id) => page.locator(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`).first()
  .evaluate((el) => ({ stroke: getComputedStyle(el).stroke, width: parseFloat(getComputedStyle(el).strokeWidth) })).catch(() => null);

// ------------------------------------------------------------ before asking

check("the canvas's own menu offers to fill in the drawn links", (await (await paneMenu("Fill in drawn links from the devices")).count()) === 1);
check("there are no management links yet, so no hide option", (await page.locator(".cv-context-menu button, .cv-menu button", { hasText: "management links" }).count()) === 0);
await page.keyboard.press("Escape");
check("no legend before anything was asked", (await page.locator('[data-region="link-legend"]').count()) === 0);
const before = await strokeOf("s1");

// ---------------------------------------------------------------- asking

await (await paneMenu("Fill in drawn links from the devices")).click();
await page.waitForTimeout(1200);
const asked = (await st(() => window.__asked)).map((a) => a.device).sort();
check("every drawn device with an address is asked, once, with its login",
  JSON.stringify(asked) === JSON.stringify(["192.0.2.1", "192.0.2.100", "192.0.2.2", "192.0.2.5"]) &&
  (await st(() => window.__asked)).every((a) => a.credentialId === "cred-1"), JSON.stringify(asked));
check("an address a device reported is never asked: nothing is discovered", !asked.includes("192.0.2.77"));
check("no crawl, sweep, shell or anything else that reaches a device was started", (await st(() => window.__other)).length === 0, JSON.stringify(await st(() => window.__other)));

const after = await edges();
const by = (id) => after.find((e) => e.id === id);
check("a confirmed link takes its port at each end, the way round it was drawn",
  by("s1").sourcePortLabel === "Eth1/1" && by("s1").targetPortLabel === "Eth1/49" && by("s1").drawnCheck === "met", JSON.stringify(by("s1")));
check("and what its port is made of: a QSFP and an SFP", by("s1").media === "qsfp" && by("s2").media === "sfp", `${by("s1").media} ${by("s2").media}`);
check("a drawn link no device reports is marked not found", by("x").drawnCheck === "unmet" && by("f").drawnCheck === "unmet");
check("no device was added to the page", (await st(() => window.__cvStore.getState().doc.pages[0].nodes.length)) === 5);
const mgmt = after.filter((e) => e.linkKind === "management");
check("the three management links are drawn, though nobody drew them", mgmt.length === 3 && after.length === 7, `${mgmt.length} of ${after.length}`);
check("each from a device's mgmt0 to the management switch's port",
  mgmt.every((e) => [e.sourcePortLabel, e.targetPortLabel].includes("mgmt0") && [e.source, e.target].includes("mg")), JSON.stringify(mgmt.map((e) => [e.sourcePortLabel, e.targetPortLabel])));

const said1 = await message();
check("the status line says what was asked, and that nothing else was contacted",
  /Asked 3 of 4 drawn devices; nothing else was contacted/.test(said1), said1);
check("what was confirmed, not found and added", /2 drawn links confirmed.*2 not found.*3 management \(3 added\)/.test(said1), said1);
check("the neighbour that is not on the page, left off it", /1 neighbour (is|are) not on this page/.test(said1), said1);
check("and the device that could not be asked, by name", /Could not ask: MGMT-SW/.test(said1), said1);

// ---------------------------------------------------------------- colours

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
const s1 = await strokeOf("s1"), s2 = await strokeOf("s2"), x = await strokeOf("x");
const m = await strokeOf(mgmt[0].id);
check("a QSFP link and an SFP link are two colours, neither the one it had", s1.stroke !== s2.stroke && s1.stroke !== before.stroke, `${before.stroke} → ${s1.stroke} / ${s2.stroke}`);
check("the link not found is purple", x.stroke === rgb("#a45cf0"), x.stroke);
check("a management link is sky blue", m.stroke === rgb("#5cc8f5"), m.stroke);
check("and thinner than a cable", m.width < s1.width, `${m.width} vs ${s1.width}`);

// ----------------------------------------------------------------- legend

const legend = page.locator('[data-region="link-legend"]');
const rows = await legend.locator(".cv-legend-item").evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
check("a legend says what the link colours mean, for the ones on the page",
  JSON.stringify(rows) === JSON.stringify(["SFP1", "QSFP1", "Management3", "Drawn, not found2"]), JSON.stringify(rows));
const swatch = await legend.locator(".cv-legend-item i").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
check("in the colours the links are drawn in", swatch[1] === s1.stroke && swatch[2] === m.stroke && swatch[3] === x.stroke, JSON.stringify(swatch));

// ------------------------------------------------ hiding management links

await (await paneMenu("Hide management links")).click();
await page.waitForTimeout(500);
check("hidden, the management links are not drawn", (await page.locator(".react-flow__edge").count()) === 4, String(await page.locator(".react-flow__edge").count()));
check("but are still in the document", (await edges()).length === 7);
check("and the legend says they are hidden", /Management3 · hidden/.test((await legend.textContent()).replace(/\s+/g, " ")));
await (await paneMenu("Show management links")).click();
await page.waitForTimeout(500);
check("shown again, they are back", (await page.locator(".react-flow__edge").count()) === 7);

// ----------------------------------------------------------- asked again

await (await paneMenu("Fill in drawn links from the devices")).click();
await page.waitForTimeout(1200);
check("asked again, nothing is drawn twice", (await edges()).length === 7 && /3 management \(0 added\)/.test(await message()), await message());

// One undo takes one asking back.
await page.keyboard.press("Control+z");
await page.keyboard.press("Control+z");
await page.waitForTimeout(400);
const undone = await edges();
check("undo takes it all back as a step: the links as drawn, no marks", undone.length === 4 && undone.every((e) => e.drawnCheck === undefined && e.sourcePortLabel === ""), JSON.stringify(undone.map((e) => [e.id, e.drawnCheck])));
await page.keyboard.press("Control+Shift+z");
await page.waitForTimeout(400);

// ------------------------------------------------------------- the marks off

await (await paneMenu("Clear the marks the devices left on links")).click();
await page.waitForTimeout(500);
const cleared = await edges();
check("the marks come off and the ports stay", cleared.every((e) => e.drawnCheck === undefined) && cleared.find((e) => e.id === "s1").sourcePortLabel === "Eth1/1", JSON.stringify(cleared.map((e) => [e.id, e.drawnCheck, e.sourcePortLabel])));
check("the link that was purple is no longer", (await strokeOf("x")).stroke !== rgb("#a45cf0"));
check("through all of it, only the drawn devices were ever asked",
  (await st(() => window.__asked)).every((a) => ["192.0.2.1", "192.0.2.2", "192.0.2.5", "192.0.2.100"].includes(a.device)) && (await st(() => window.__other)).length === 0);

// --------------------------------------- a menu taller than the window

await page.setViewportSize({ width: 1100, height: 620 });
await page.waitForTimeout(300);
await paneMenu("Fit view");
const menu = page.locator(".cv-context-menu, .cv-menu").first();
const box = await menu.boundingBox();
check("a menu longer than the window stays inside it", box.y >= 0 && box.y + box.height <= 620, JSON.stringify(box));
const last = menu.locator("button").last();
await last.scrollIntoViewIfNeeded();
const lastBox = await last.boundingBox();
check("and its last entry can be reached by scrolling", lastBox.y >= box.y && lastBox.y + lastBox.height <= box.y + box.height + 1 && lastBox.y + lastBox.height <= 620, JSON.stringify(lastBox));
await page.keyboard.press("Escape");
await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
