// Accessibility as a build: the rail one tab stop with arrows and Ctrl and a
// digit, controls big enough to hit, focus rings outside the border, the
// arrows between a table's rows, the status strip read from the keyboard,
// and high contrast as a bigger, heavier interface. Stubbed backend.
// Invented names only.
//
//     npm run dev            # in another terminal
//     node e2e/a11y.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const device = (id, label, x, y) => ({
  id, type: "device", position: { x, y }, width: 76, height: 76,
  data: { label, deviceType: "access-switch", tags: [], addresses: [{ id: `${id}-a`, label: "Mgmt", address: `192.0.2.${x / 100 + 10}`, isPrimary: true }], locked: false, maintenance: false, showDetails: true },
});

const project = {
  meta: { id: "a11y", name: "Keys", customer: "", site: "", ticket: "", engineer: "", description: "", createdAt: NOW, updatedAt: NOW, archived: false },
  documentVersion: 1,
  document: {
    nodes: [device("n1", "SW-ONE", 0, 0), device("n2", "SW-TWO", 300, 0), device("n3", "SW-THREE", 600, 0)],
    edges: [],
    probes: ["n1", "n2", "n3"].map((n, i) => ({ id: `p${i}`, objectId: n, kind: "icmp", target: `192.0.2.${i * 3 + 10}`, enabled: true, intervalMs: 5000, timeoutMs: 1000, failureThreshold: 3 })),
    canvas: {},
  },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.addInitScript(({ p }) => {
  localStorage.setItem("corelens.projects.v1", JSON.stringify({ [p.meta.id]: p }));
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback() { return next++; },
    invoke(cmd) {
      if (cmd === "plugin:event|listen") return Promise.resolve(next++);
      const meta = { id: p.meta.id, name: p.meta.name, customer: "", site: "", ticket: "", engineer: "", description: "", created_at: p.meta.createdAt, updated_at: p.meta.updatedAt, archived: false };
      if (cmd === "list_projects") return Promise.resolve([meta]);
      if (cmd === "load_project") return Promise.resolve({ meta, document_version: p.documentVersion, document: p.document });
      if (cmd === "get_settings") return Promise.resolve({});
      return Promise.resolve([]);
    },
  };
}, { p: project });
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(800);

const st = (fn, arg) => page.evaluate(fn, arg);
const focused = () => page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el?.tagName, text: el?.textContent?.trim() ?? "", id: el?.getAttribute("data-id"), role: el?.getAttribute("role") };
});

// --- the rail ---------------------------------------------------------------
{
  const rail = page.locator('[data-region="nav"]');
  check("the rail is a tab list", (await rail.getAttribute("role")) === "tablist");
  const stops = await rail.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.tabIndex));
  check("with one tab stop among its items", stops.filter((n) => n === 0).length === 1 && stops.length === 10, JSON.stringify(stops));
  const showing = await page.locator(".cv-nav-item.is-current").innerText();
  await rail.locator('[role="tab"][tabindex="0"]').focus();
  check("the stop is the item showing", (await focused()).text.startsWith(showing), JSON.stringify({ showing, f: await focused() }));
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  check("the arrows move along it", (await focused()).text.startsWith("Paths"), JSON.stringify(await focused()));
  check("without opening anything", (await page.locator(".cv-nav-item.is-current").innerText()) === showing);
  await page.keyboard.press("End");
  check("End goes to the last item", (await focused()).text.startsWith("Settings"));
  await page.keyboard.press("Home");
  check("and Home to the first", (await focused()).text.startsWith("Diagram"));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check("Enter opens the one focused", (await page.locator(".cv-nav-item.is-current").innerText()) === "Discover");

  // Ctrl and a digit, from the canvas.
  await page.locator(".react-flow__pane").click({ position: { x: 400, y: 300 } });
  await page.keyboard.down("Control");
  await page.waitForTimeout(150);
  const digit = () => page.evaluate(() => getComputedStyle(document.querySelector(".cv-nav-item[data-key]"), "::after").content);
  check("holding Ctrl shows each item's digit", (await digit()) === '"1"', await digit());
  await page.keyboard.press("3");
  await page.keyboard.up("Control");
  await page.waitForTimeout(400);
  check("Ctrl+3 goes to the third item, Monitor", (await page.locator(".cv-nav-item.is-current").innerText()) === "Monitor");
  check("and the digits go when Ctrl is let go", (await digit()) === "none", await digit());
  check("the digit is never part of the item's name", (await rail.locator('[role="tab"]').first().textContent()) === "Diagram");
  check("the tooltip names the shortcut", (await rail.locator('[role="tab"]').nth(2).getAttribute("title")) === "Monitor  Ctrl+3");
}

// --- something to aim at ---------------------------------------------------
{
  const heights = await page.evaluate(() => {
    const h = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null).map((e) => e.getBoundingClientRect().height);
    return { btn: h(".cv-btn:not(.cv-btn-small)"), small: h(".cv-btn-small"), tab: h('.cv-panel [role="tab"]'), input: h("input.cv-input") };
  });
  const min = (a) => Math.min(...a);
  check("a button is at least 32 px tall", heights.btn.length > 0 && min(heights.btn) >= 31.5, JSON.stringify(heights.btn.slice(0, 8)));
  check("a small button at least 28", heights.small.length > 0 && min(heights.small) >= 27.5, JSON.stringify(heights.small.slice(0, 8)));
  check("a tab at least 28", heights.tab.length > 0 && min(heights.tab) >= 27.5, JSON.stringify(heights.tab.slice(0, 8)));
  check("a field at least 32", heights.input.length > 0 && min(heights.input) >= 31.5, JSON.stringify(heights.input.slice(0, 8)));
  await page.locator('.cv-panel [role="tab"]').first().focus();
  await page.keyboard.press("ArrowRight");
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { offset: s.outlineOffset, width: s.outlineWidth, style: s.outlineStyle };
  });
  check("the focus ring sits just outside the border, not over the next control", ring.offset === "0px" && ring.style !== "none", JSON.stringify(ring));
}

// --- the arrows between a table's rows ---------------------------------------
{
  await page.locator('.cv-panel [role="tab"]', { hasText: "Monitored objects" }).click();
  await page.waitForTimeout(300);
  const rows = page.locator(".cv-panel tbody tr[data-id]");
  check("the monitored list has a row per device", (await rows.count()) === 3, String(await rows.count()));
  await rows.first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const selected = await st(() => window.__cvStore.getState().selectedNodeId);
  const before = await st((id) => window.__cvStore.getState().doc.pages[0].nodes.find((n) => n.id === id).position, selected);
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  check("Down moves to the next row", (await focused()).id === (await rows.nth(1).getAttribute("data-id")), JSON.stringify(await focused()));
  const after = await st((id) => window.__cvStore.getState().doc.pages[0].nodes.find((n) => n.id === id).position, selected);
  check("and does not nudge the device the first row selected", before.x === after.x && before.y === after.y, JSON.stringify({ before, after }));
  await page.keyboard.press("End");
  check("End to the last row", (await focused()).id === (await rows.nth(2).getAttribute("data-id")));
  await page.keyboard.press("ArrowUp");
  check("Up back one", (await focused()).id === (await rows.nth(1).getAttribute("data-id")));
}

// --- the status strip from the keyboard ---------------------------------------
{
  await st(() => window.__cvStore.getState().select("n1", null));
  await page.waitForTimeout(400);
  const strip = page.locator(".cv-history-strip");
  const readout = page.locator('[data-region="history-readout"]');
  check("the strip says the time and status before anyone points at it", /—\s+Not checked/.test(await readout.innerText()), await readout.innerText());
  check("and can take focus", (await strip.getAttribute("tabindex")) === "0" && (await strip.getAttribute("role")) === "slider");
  await strip.focus();
  const at = async () => Number(await strip.getAttribute("aria-valuenow"));
  check("its cursor starts at now", (await at()) === 100);
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  check("the arrows move the cursor back in time", (await at()) < 90, String(await at()));
  check("with a scrub line drawn where it is", (await page.locator(".cv-history-scrub").count()) === 1);
  check("and its value says the time and status there", /—/.test((await strip.getAttribute("aria-valuetext")) ?? ""));
  await page.keyboard.press("Home");
  check("Home is the start of the window", (await at()) === 0);
}

// --- high contrast --------------------------------------------------------------
{
  const scale = () => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")));
  check("the interface starts at its own scale", (await scale()) === 1, String(await scale()));
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.keyboard.type(">high contrast");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  check("high contrast is a command in the palette", (await page.locator(".cv-app.is-contrast").count()) > 0);
  check("and never smaller than 115 %", (await scale()) >= 1.15, String(await scale()));
  const looks = await page.evaluate(() => {
    const btn = document.querySelector(".cv-btn");
    const tab = document.querySelector('.cv-panel [role="tab"][aria-selected="true"]');
    return { border: btn ? getComputedStyle(btn).borderTopWidth : null, tab: tab ? getComputedStyle(tab).boxShadow : null };
  });
  check("controls have two-pixel edges", looks.border === "2px", JSON.stringify(looks));
  check("the open tab is marked by a heavy underline", /inset/.test(looks.tab ?? "") && /-3px/.test(looks.tab ?? ""), JSON.stringify(looks));
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.keyboard.type(">high contrast");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  check("and the same command turns it off", (await page.locator(".cv-app.is-contrast").count()) === 0 && (await scale()) === 1);
}

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
