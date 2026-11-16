// Get device info: one device asked what it is, with no crawl.
//
// Right-click a device, choose Get device info, and its model, serials,
// software and hostname land in its fields. What is checked here is the path
// through the window: the menu entry, the two refusals before anything is
// sent, that exactly one command goes to the backend for exactly this
// device's address — never a crawl, a sweep or a collection — that what the
// device did not say keeps what was typed, and that the status line says
// what was asked.
//
// The backend is stubbed; what the real one sends a device is held by the
// Rust tests in `corelens-discover/src/deviceinfo.rs`.
//
//     npm run dev            # in another terminal
//     node e2e/deviceinfo.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

let at = 0;
const node = (id, label, over = {}) => {
  const x = at;
  at += 220;
  return {
    id, type: "device", position: { x, y: 0 }, width: 76, height: 76,
    data: { label, deviceType: "core-switch", tags: [], ...over },
  };
};

const project = {
  meta: { id: "ssh", name: "SSH", customer: "", site: "", ticket: "", engineer: "",
    description: "", createdAt: NOW, updatedAt: NOW, archived: false },
  documentVersion: 1,
  document: {
    activePageId: "p1", probes: [],
    pages: [{ id: "p1", name: "Core",
      canvas: { gridEnabled: true, snapEnabled: true, minimap: false, nodeStyle: "glyph" },
      // One link, CORE-SW1 to ACCESS-SW7: what makes each the other's neighbour.
      edges: [{ id: "ab", source: "a", target: "b", sourceHandle: "r", targetHandle: "l", type: "live",
        data: { sourcePortLabel: "", targetPortLabel: "", label: "", pathType: "straight", direction: "none", width: 2,
          color: "#2fbf6b", enabled: true, maintenance: false, healthRule: { type: "manual", manualStatus: "unknown" } } }],
      nodes: [
        node("a", "CORE-SW1", { hostname: "CORE-SW1", sshCredentialId: "cred-1",
          addresses: [{ id: "x", label: "Mgmt", address: "192.0.2.10", isPrimary: true }] }),
        node("b", "ACCESS-SW7", { sshCredentialId: "cred-1",
          addresses: [{ id: "y", label: "Mgmt", address: "192.0.2.11", isPrimary: true }] }),
        node("c", "NO-LOGIN", { addresses: [{ id: "z", label: "Mgmt", address: "192.0.2.12", isPrimary: true }] }),
        node("d", "NO-ADDRESS", { sshCredentialId: "cred-1", addresses: [] }),
        // Answers slowly: long enough to turn the page while it is asked.
        node("s", "SLOW-SW9", { hostname: "SLOW-SW9", sshCredentialId: "cred-1",
          addresses: [{ id: "w", label: "Mgmt", address: "192.0.2.50", isPrimary: true }] }),
      ] },
      // A second page, with the slow device drawn on it again.
      { id: "p2", name: "Site",
        canvas: { gridEnabled: true, snapEnabled: true, minimap: false, nodeStyle: "glyph" },
        edges: [],
        nodes: [
          node("s2", "SLOW-SW9 (site)", { sshCredentialId: "cred-1",
            addresses: [{ id: "v", label: "Mgmt", address: "192.0.2.50", isPrimary: true }] }),
          node("o", "OTHER-SW", { addresses: [{ id: "u", label: "Mgmt", address: "192.0.2.51", isPrimary: true }] }),
        ] }],
  },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });

await page.addInitScript(({ p }) => {
  const listeners = {}, callbacks = {};
  let next = 1;
  window.__calls = [];    // every command that could reach a device
  window.__asked = [];    // every get_device_info payload
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) { const id = next++; callbacks[id] = cb; return id; },
    invoke(cmd, args) {
      if (cmd === "plugin:event|listen") { listeners[args.event] = args.handler; return Promise.resolve(next++); }
      const meta = { id: p.meta.id, name: p.meta.name, customer: "", site: "", ticket: "",
        engineer: "", description: "", created_at: p.meta.createdAt, updated_at: p.meta.updatedAt, archived: false };
      if (/^(start_|ssh_open|ping_from|traceroute_from|collection_live|test_credential)/.test(cmd)) window.__calls.push(cmd);
      if (cmd === "list_projects") return Promise.resolve([meta]);
      if (cmd === "load_project") return Promise.resolve({ meta, document_version: p.documentVersion, document: p.document });
      if (cmd === "vault_status") return Promise.resolve({ exists: true, unlocked: true, credentials: 1, minimumPassphrase: 12, keptInKeychain: true });
      if (cmd === "list_credentials") return Promise.resolve([{ id: "cred-1", label: "Lab", kind: "ssh", username: "ops", detail: "", hasSecondSecret: false }]);
      if (cmd === "get_device_info") {
        window.__asked.push(args);
        if (args.device === "192.0.2.11") return Promise.reject("192.0.2.11 refused the login");
        if (args.device === "192.0.2.50") return new Promise((done) => setTimeout(() => done({
          hostname: "SLOW-SW9", family: "Cisco IOS", model: "C9200L-24T", serials: ["FOC0009TEST"],
          software: null, mac: null, uptimeSeconds: 60, stack: null,
          addresses: [{ ip: "192.0.2.50", interface: "Vlan10", isManagement: true }], commands: ["show version"], unverified: false,
        }), 1500));
        return Promise.resolve({
          hostname: "CORE-SW1", family: "Cisco IOS", model: "C9300-48P",
          serials: ["FOC0000TEST", "FOC0001TEST"], software: "Cisco IOS Software, Version 16.12.4",
          mac: null, uptimeSeconds: 3600, stack: null,
          addresses: [{ ip: "192.0.2.10", interface: "Vlan10", isManagement: true }, { ip: "198.51.100.1", interface: "Vlan20", isManagement: false },
            // Link-local: on every interface of a real device, reachable from nowhere else.
            { ip: "fe80::1", interface: "Vlan20", isManagement: false }, { ip: "169.254.1.1", interface: "Gi0/0", isManagement: false }], commands: ["show version", "show switch"], unverified: false,
        });
      }
      if (cmd === "get_settings") return Promise.resolve({});
      if (cmd === "save_project") { window.__saved = args; return Promise.resolve(); }
      return Promise.resolve([]);
    },
  };
}, { p: project });

page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(900);

const st = (fn, arg) => page.evaluate(fn, arg);
const rightClick = async (label) => {
  const n = page.locator(".react-flow__node", { hasText: label }).first();
  await n.click({ button: "right" });
  await page.waitForTimeout(300);
};
const menuItem = (text) => page.locator(".cv-context-menu button, .cv-menu button", { hasText: text }).first();
const message = () => page.locator(".cv-panel-message").textContent().catch(() => "");
const ITEM = "Get device info";

// ------------------------------------------- refused before anything is sent

await rightClick("NO-ADDRESS");
check("a device offers Get device info on the right-click menu", (await menuItem(ITEM).count()) === 1);
await menuItem(ITEM).click();
await page.waitForTimeout(400);
check("a device with no address says so", /no address/i.test(await message()), await message());

await rightClick("NO-LOGIN");
await menuItem(ITEM).click();
await page.waitForTimeout(400);
check("a device with no login says which half is missing", /No login for this device/i.test(await message()), await message());
check("and neither sent anything", (await st(() => window.__asked)).length === 0);

// ------------------------------------------------------- one device, asked

await rightClick("CORE-SW1");
await menuItem(ITEM).click();
await page.waitForTimeout(700);
const asked = await st(() => window.__asked);
check("exactly one request goes out, for this device's own address and login",
  asked.length === 1 && asked[0].device === "192.0.2.10" && asked[0].credentialId === "cred-1", JSON.stringify(asked));
check("nothing else that reaches a device was started — no crawl, sweep, collection or shell",
  (await st(() => window.__calls)).length === 0, JSON.stringify(await st(() => window.__calls)));
const said = await message();
check("the status line names what was filled in", /CORE-SW1: filled in .*model.*serial.*software/.test(said), said);
check("and what the device was asked", /Asked only this device: show version, show switch/.test(said), said);

// The fields, read where a person reads them.
await page.locator(".react-flow__node", { hasText: "CORE-SW1" }).first().click();
await page.waitForTimeout(300);
await page.locator("[role=tab]", { hasText: "Identity" }).first().click().catch(() => {});
await page.waitForTimeout(300);
const values = await page.locator(".cv-inspector input, .cv-inspector textarea").evaluateAll((els) => els.map((e) => e.value));
check("the model is in the device's fields", values.includes("C9300-48P"), JSON.stringify(values.filter(Boolean)));
check("every serial is in the device's fields", values.includes("FOC0000TEST, FOC0001TEST"));
check("and the software", values.includes("Cisco IOS Software, Version 16.12.4"));
check("the display name is the drawing's and was not changed", values.includes("CORE-SW1"));

// Its own interface addresses, under Checks; the one it is managed on stays primary.
await page.locator("[role=tab]", { hasText: "Checks" }).first().click();
await page.waitForTimeout(300);
const listed = await page.locator(".cv-inspector input").evaluateAll((els) => els.map((e) => e.value));
check("its other interface address is listed under Checks, by interface name",
  listed.includes("198.51.100.1") && listed.includes("Vlan20"), JSON.stringify(listed.filter(Boolean)));
check("the address it is managed on is still there, once, under the label it was given",
  // A second entry for it would carry the interface's name; the probe's own target field also shows the address.
  listed.indexOf("192.0.2.10") === listed.indexOf("Mgmt") + 1 && !listed.includes("Vlan10"), JSON.stringify(listed.filter(Boolean)));
check("a link-local address is not listed: nothing off that link could reach it",
  !listed.some((v) => /^fe80|^169\.254\./i.test(v)), JSON.stringify(listed.filter(Boolean)));
check("the status line says interface addresses were added", /interface addresses/.test(said), said);

// A second time: the same answers change nothing.
await rightClick("CORE-SW1");
await menuItem(ITEM).click();
await page.waitForTimeout(700);
check("asked again, it says nothing is new", /nothing new/.test(await message()), await message());

// ------------------------------------------------------ a device that refuses

await rightClick("ACCESS-SW7");
await menuItem(ITEM).click();
await page.waitForTimeout(700);
check("a refusal is reported as itself, by name", /Could not read ACCESS-SW7: 192\.0\.2\.11 refused the login/.test(await message()), await message());
check("still nothing but the three requests", (await st(() => window.__asked)).length === 3 && (await st(() => window.__calls)).length === 0);

// ------------------------------------- the page turned while a device answers

const modelOf = (id) => st((id) => window.__cvStore.getState().doc.pages.flatMap((p) => p.nodes).find((n) => n.id === id)?.data.model ?? null, id);
await rightClick("SLOW-SW9");
await menuItem(ITEM).click();
await page.waitForTimeout(200);
await st(() => window.__cvStore.getState().setActivePage("p2"));
check("the page was turned before the device answered", (await modelOf("s")) === null && (await st(() => window.__cvStore.getState().doc.activePageId)) === "p2");
await page.waitForTimeout(1900);
const late = await message();
check("its answer is not thrown away: the device is filled on the page it was asked from", (await modelOf("s")) === "C9200L-24T", late);
check("and the drawing of it on the other page is filled too", (await modelOf("s2")) === "C9200L-24T");
check("another device on that page is not", (await modelOf("o")) === null);
check("the drawing keeps its own name", (await st(() => window.__cvStore.getState().doc.pages[1].nodes[0].data.label)) === "SLOW-SW9 (site)");
check("the status line says both drawings were filled, not that the device is gone", /SLOW-SW9: filled in .*model.*all 2 drawings/.test(late) && !/no longer/.test(late), late);
check("the page in front is still the one turned to", (await st(() => window.__cvStore.getState().doc.activePageId)) === "p2");

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
