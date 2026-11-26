// The diagram keeps its room: in a laptop-sized window with the terminal
// down the right, the shape list and the inspector fold before the canvas is
// squeezed, and the terminal moves below when even that is not enough. And
// the interface's own size: by itself with the window, and Ctrl+Shift + − 0.
//
//     npm run dev            # in another terminal
//     node e2e/roomy.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = Date.now();

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const canvas = { gridEnabled: true, snapEnabled: true, minimap: false, nodeStyle: "glyph" };
const node = (id, x, y) => ({ id, type: "device", position: { x, y }, data: { label: id.toUpperCase(), kind: "switch", address: "192.0.2.1" } });
const project = {
  meta: { id: "roomy", name: "Roomy", customer: "", site: "", createdAt: NOW, updatedAt: NOW },
  document: { activePageId: "p1", probes: [], pages: [{ id: "p1", name: "Core", canvas, nodes: [node("sw1", 0, 0), node("sw2", 300, 0)], edges: [] }] },
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
const page = await context.newPage();
await page.addInitScript(({ p }) => {
  const callbacks = {};
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) { const id = next++; callbacks[id] = cb; return id; },
    invoke(cmd) {
      if (cmd === "plugin:event|listen") return Promise.resolve(next++);
      const meta = { id: p.meta.id, name: p.meta.name, customer: "", site: "", ticket: "", engineer: "", description: "", created_at: p.meta.createdAt, updated_at: p.meta.updatedAt, archived: false };
      if (cmd === "list_projects") return Promise.resolve([meta]);
      if (cmd === "load_project") return Promise.resolve({ meta, document_version: 1, document: p.document });
      if (cmd === "get_settings") return Promise.resolve({});
      if (cmd === "vault_status") return Promise.resolve({ exists: true, unlocked: true, credentials: 0, minimumPassphrase: 12 });
      if (cmd === "save_project") return Promise.resolve(null);
      return Promise.resolve([]);
    },
  };
}, { p: project });
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(800);

const st = (fn, arg) => page.evaluate(fn, arg);
const width = (sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  return getComputedStyle(el).display === "none" ? 0 : Math.round(r.width);
}, sel);
const scale = () => st(() => Number(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")));
const settle = () => page.waitForTimeout(400);

// --- the interface's size follows the window --------------------------------
const small = await scale();
check("a laptop-sized window draws the interface smaller by itself", small > 0 && small < 1, String(small));
await page.setViewportSize({ width: 1500, height: 900 });
await settle();
check("a normal window draws it at its own size", (await scale()) === 1, String(await scale()));
await page.setViewportSize({ width: 1000, height: 800 });
await settle();

// --- the terminal opens down the right --------------------------------------
await st(() => { const s = window.__cvStore.getState(); s.setDockTab("ssh"); s.setPanelOpen?.(true); });
await settle();
check("the terminal is down the right", (await page.locator(".cv-body.is-dock-right").count()) === 1);
const emptyDock = await width(".cv-body > .cv-panel");
const rf = await width(".react-flow");
check("the diagram keeps a usable width beside an empty terminal", rf >= 320, `diagram ${rf}px, terminal ${emptyDock}px`);
// A session widens the terminal.
await st(() => window.__cvStore.getState().openSshTab({ id: "t1", address: "192.0.2.1", label: "SW1", status: "open" }));
await settle();
const withSession = await width(".cv-body > .cv-panel");
check("an empty terminal tab is narrower than one with a session", emptyDock > 0 && emptyDock < withSession, `${emptyDock} → ${withSession}`);
const rf2 = await width(".react-flow");
check("with a session open the diagram still keeps its room", rf2 >= 320, `diagram ${rf2}px`);
check("the terminal narrows before anything else gives way", withSession < 500, String(withSession));
check("the shape list's way back is always there", (await page.locator(".cv-rail-left").count()) === 1);

// Selecting a device brings its inspector back.
await st(() => window.__cvStore.getState().select("sw1", null));
await settle();
const insp = await width(".cv-inspector");
const placeAfterSelect = await page.locator(".cv-body.is-dock-right").count();
const rf3 = await width(".react-flow");
check("selecting a device shows its inspector", insp > 0, `inspector ${insp}px`);
check("and the diagram is not squeezed for it: the terminal goes below if it must", rf3 >= 320, `diagram ${rf3}px, right ${placeAfterSelect}`);
await st(() => window.__cvStore.getState().select(null, null));
await settle();

// A wide window gives everything back.
await page.setViewportSize({ width: 1900, height: 1000 });
await settle();
check("a wide window unfolds the shape list again", (await width(".cv-palette")) > 0);
check("and keeps the inspector, the terminal and a wide diagram beside each other",
  (await width(".cv-inspector")) > 0 && (await width(".react-flow")) >= 450 && (await width(".cv-body > .cv-panel")) >= 700,
  `${await width(".cv-inspector")} / ${await width(".react-flow")} / ${await width(".cv-body > .cv-panel")}`);
check("and the terminal is back down the right", (await page.locator(".cv-body.is-dock-right").count()) === 1);
// What was folded by hand stays folded.
await st(() => window.__cvStore.getState().setPaletteOpen(false));
await page.setViewportSize({ width: 1000, height: 800 });
await settle();
await page.setViewportSize({ width: 1900, height: 1000 });
await settle();
check("a shape list folded by hand stays folded", (await width(".cv-palette")) === 0);
await st(() => window.__cvStore.getState().setPaletteOpen(true));

// --- the keys -----------------------------------------------------------------
await page.setViewportSize({ width: 1500, height: 900 });
await settle();
await page.locator(".react-flow__pane").click({ position: { x: 200, y: 300 } });
const zoom = () => st(() => document.querySelector(".react-flow__viewport")?.style.transform ?? "");
const z0 = await zoom();
await page.keyboard.press("Control+Shift+Equal");
await settle();
check("Ctrl+Shift+= makes the whole interface bigger", Math.abs((await scale()) - 1.1) < 0.001, String(await scale()));
check("and leaves the diagram's zoom alone", (await zoom()) === z0);
check("it says the new size", /110/.test(await st(() => window.__cvStore.getState().statusMessage ?? "")));
await page.keyboard.press("Control+Shift+Minus");
await page.keyboard.press("Control+Shift+Minus");
await page.keyboard.press("Control+Shift+Minus");
await settle();
check("Ctrl+Shift+− makes it smaller", Math.abs((await scale()) - 0.8) < 0.001, String(await scale()));
for (let i = 0; i < 10; i++) await page.keyboard.press("Control+Shift+Minus");
await settle();
check("never under 50 %", Math.abs((await scale()) - 0.5) < 0.001, String(await scale()));
await page.keyboard.press("Control+Equal");
await settle();
check("Ctrl+= still zooms only the diagram", (await zoom()) !== z0 && Math.abs((await scale()) - 0.5) < 0.001);
await page.keyboard.press("Control+Shift+Equal");
await settle();
await page.reload({ waitUntil: "networkidle" });
await settle();
check("the size chosen is remembered", Math.abs((await scale()) - 0.6) < 0.001, String(await scale()));
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(600);
await page.locator(".react-flow__pane").click({ position: { x: 200, y: 300 } });
await page.keyboard.press("Control+Shift+Digit0");
await settle();
check("Ctrl+Shift+0 goes back to following the window", (await scale()) === 1 && (await st(() => window.__cvStore.getState().settings.uiScale)) === "auto",
  String(await scale()));

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
