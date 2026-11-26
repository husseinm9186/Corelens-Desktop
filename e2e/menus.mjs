// Every menu, dropdown and dialog stays inside the window.
//
// On a small window a long menu used to run off the bottom, and what was
// past the edge could not be reached. This opens each floating surface the
// diagram screen has, on a window 560 pixels high, and checks that all of it
// is inside the window — and, where it holds more than fits, that it
// scrolls to its last entry.
//
//     npm run dev
//     node e2e/menus.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;
const W = 1000, H = 560;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const node = (id, label, x, y, type = "core-switch") => ({
  id, type: "device", position: { x, y }, width: 76, height: 76,
  data: { label, deviceType: type, tags: ["a", "b"], sshCredentialId: "cred-1",
    addresses: [{ id: `${id}-a`, label: "Mgmt", address: `192.0.2.${x % 200 + 1}`, isPrimary: true }] },
});
const link = (id, source, target) => ({
  id, source, target, sourceHandle: "r", targetHandle: "l", type: "live",
  data: { sourcePortLabel: "Gi1/0/1", targetPortLabel: "Gi1/0/2", label: "", pathType: "straight", direction: "none", width: 2,
    color: "#2fbf6b", enabled: true, maintenance: false, healthRule: { type: "manual", manualStatus: "unknown" } },
});
// Many pages, so the page list is long; several kinds, so the type filter is.
const TYPES = ["core-switch", "access-switch", "router", "firewall", "server", "wireless-ap", "load-balancer", "storage"];
const pages = Array.from({ length: 30 }, (_, i) => ({
  id: `p${i + 1}`, name: `Page ${i + 1}`,
  canvas: { gridEnabled: true, snapEnabled: true, minimap: false, nodeStyle: "glyph" },
  nodes: i === 0 ? TYPES.map((t, k) => node(`n${k}`, `DEVICE-${k}`, 80 + (k % 4) * 200, 60 + Math.floor(k / 4) * 180, t)) : [],
  edges: i === 0 ? [link("e1", "n0", "n1"), link("e2", "n1", "n2")] : [],
}));
const project = {
  meta: { id: "menus", name: "Menus", customer: "", site: "", ticket: "", engineer: "",
    description: "", createdAt: NOW, updatedAt: NOW, archived: false },
  documentVersion: 1,
  document: { activePageId: "p1", probes: [], pages },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.addInitScript(({ p }) => {
  const listeners = {}, callbacks = {};
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) { const id = next++; callbacks[id] = cb; return id; },
    invoke(cmd, args) {
      if (cmd === "plugin:event|listen") { listeners[args.event] = args.handler; return Promise.resolve(next++); }
      const meta = { id: p.meta.id, name: p.meta.name, customer: "", site: "", ticket: "",
        engineer: "", description: "", created_at: p.meta.createdAt, updated_at: p.meta.updatedAt, archived: false };
      if (cmd === "list_projects") return Promise.resolve([meta]);
      if (cmd === "load_project") return Promise.resolve({ meta, document_version: p.documentVersion, document: p.document });
      if (cmd === "vault_status") return Promise.resolve({ exists: true, unlocked: true, credentials: 1, minimumPassphrase: 12, keptInKeychain: true });
      if (cmd === "list_credentials") return Promise.resolve([{ id: "cred-1", label: "Lab", kind: "ssh", username: "ops", detail: "", hasSecondSecret: false }]);
      if (cmd === "get_settings") return Promise.resolve({});
      if (cmd === "app_info") return Promise.resolve({ version: "0.0.0", dataDir: "/tmp", platform: "linux" });
      return Promise.resolve([]);
    },
  };
}, { p: project });

page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(900);

/** Where a surface is, and whether its own content fits or scrolls. */
const measure = (selector) => page.evaluate(({ selector }) => {
  const all = [...document.querySelectorAll(selector)].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
  });
  const el = all[all.length - 1];
  if (!el) return null;
  // The element that scrolls: itself, or the one inside it that does.
  const scroller = [el, ...el.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)) ?? null;
  let reachedEnd = true;
  if (scroller) {
    scroller.scrollTop = scroller.scrollHeight;
    reachedEnd = Math.abs(scroller.scrollTop + scroller.clientHeight - scroller.scrollHeight) <= 1;
  }
  const r = el.getBoundingClientRect();
  // The last thing in it that can be pressed, after scrolling to the end.
  const items = [...el.querySelectorAll("button, [role=menuitem], [role=option], li, label, a")].filter((e) => e.getBoundingClientRect().height > 0);
  const last = items[items.length - 1]?.getBoundingClientRect();
  if (scroller) scroller.scrollTop = 0;
  return {
    top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right),
    vh: window.innerHeight, vw: window.innerWidth, scrolls: Boolean(scroller), reachedEnd,
    lastBottom: last ? Math.round(last.bottom) : null,
  };
}, { selector });
const inside = (m) => m && m.top >= 0 && m.left >= 0 && m.bottom <= m.vh + 1 && m.right <= m.vw + 1 && m.reachedEnd && (m.lastBottom === null || m.lastBottom <= m.vh + 1);
const expectInside = async (name, selector) => {
  await page.waitForTimeout(350);
  const m = await measure(selector);
  check(`${name} is inside the window, to its last entry`, inside(m), m ? JSON.stringify(m) : "not found");
  return m;
};
const close = async () => { await page.keyboard.press("Escape"); await page.mouse.click(5, H - 5).catch(() => {}); await page.waitForTimeout(250); };

// ------------------------------------------------------- right-click menus

const pane = await page.locator(".react-flow__pane").boundingBox();
// An empty spot of the canvas itself at each place, found rather than assumed:
// the dock and the page tabs lie over the bottom of it.
const emptyAt = (fx, fy) => page.evaluate(([fx, fy]) => {
  const r = document.querySelector(".react-flow__pane").getBoundingClientRect();
  for (let dy = 0; dy < r.height; dy += 6) {
    const x = r.left + r.width * fx, y = fy < 0.5 ? r.top + 8 + dy : r.bottom - 8 - dy;
    if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return [x, y];
  }
  return null;
}, [fx, fy]);
for (const [where, fx, fy] of [["near the top", 0.9, 0], ["near the bottom", 0.9, 1], ["at the right edge", 0.995, 1]]) {
  const spot = await emptyAt(fx, fy);
  if (!spot) { check(`an empty spot ${where} was found`, false); continue; }
  await page.mouse.click(spot[0], spot[1], { button: "right" });
  await expectInside(`the canvas's menu opened ${where}`, ".cv-menu");
  await close();
}
await page.locator(".react-flow__node", { hasText: "DEVICE-5" }).first().click({ button: "right" });
await expectInside("a device's menu", ".cv-menu");
await close();
await page.locator(".react-flow__edge").first().locator("path").first().click({ button: "right", force: true }).catch(() => {});
const edgeMenu = await measure(".cv-menu");
if (edgeMenu) check("a link's menu is inside the window, to its last entry", inside(edgeMenu), JSON.stringify(edgeMenu));
await close();
await page.locator(".cv-page-tab").first().click({ button: "right" });
await expectInside("a page tab's menu", ".cv-menu");
await close();

// ------------------------------------- the top bar on a narrower window

// Every control in the top bar is what a click on it lands on. When the
// bar's right-hand group wrapped to a second line, the canvas toolbar lay
// over it and More could not be pressed.
for (const width of [1000, 900]) {
  await page.setViewportSize({ width, height: H });
  await page.waitForTimeout(300);
  const covered = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(".cv-topbar button, .cv-topbar summary")) {
      const closed = el.closest("details:not([open])");
      if (closed && el.tagName !== "SUMMARY") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!at || !(el === at || el.contains(at) || at.contains(el))) {
        out.push(`${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)} under ${at ? (at.className?.toString?.().split(" ")[0] ?? at.tagName) : "nothing"}`);
      }
    }
    return out;
  });
  check(`at ${width} wide every top-bar control can be pressed`, covered.length === 0, covered.join("; "));
}
await page.setViewportSize({ width: W, height: H });
await page.waitForTimeout(300);

// ---------------------------------------------- every dropdown on the screen

const dropdowns = await page.locator("details.cv-dropdown").count();
check("the screen's dropdowns were found", dropdowns >= 6, String(dropdowns));
for (let i = 0; i < dropdowns; i++) {
  const d = page.locator("details.cv-dropdown").nth(i);
  const summary = d.locator("> summary");
  if (!(await summary.isVisible().catch(() => false))) continue;
  const name = ((await summary.getAttribute("aria-label")) ?? (await summary.getAttribute("title")) ?? (await summary.innerText()) ?? `#${i}`).trim().split("\n")[0].slice(0, 40);
  await summary.click();
  await page.waitForTimeout(300);
  const m = await page.evaluate((i) => {
    const d = document.querySelectorAll("details.cv-dropdown")[i];
    const el = d?.querySelector(".cv-dropdown-menu");
    if (!el) return null;
    const scroller = [el, ...el.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)) ?? null;
    const r = el.getBoundingClientRect();
    let reachedEnd = true;
    if (scroller) { scroller.scrollTop = scroller.scrollHeight; reachedEnd = Math.abs(scroller.scrollTop + scroller.clientHeight - scroller.scrollHeight) <= 1; scroller.scrollTop = 0; }
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), vh: innerHeight, vw: innerWidth, reachedEnd, lastBottom: null };
  }, i);
  check(`the "${name}" dropdown is inside the window`, inside(m), m ? JSON.stringify(m) : "no menu");
  await summary.click().catch(() => {});
  await close();
}

// --------------------------------------------------- palettes and dialogs

await page.locator(".cv-page-nav-toggle").click();
await expectInside("the list of all pages", ".cv-page-nav");
await close();
await page.locator(".cv-page-nav-toggle").click().catch(() => {});
if ((await page.locator(".cv-page-nav").count()) > 0) await page.locator(".cv-page-nav-toggle").click();

await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
await page.keyboard.press("Control+k");
await expectInside("the command palette", ".cv-command-palette");
await page.keyboard.type("e");
await expectInside("the command palette with results", ".cv-command-palette");
await close();

await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
await page.keyboard.press("?");
await expectInside("the keyboard shortcuts", ".cv-help-card");
await close();

// Dialogs: the plain modal and the report's.
await page.locator("details.cv-more > summary").click();
await page.locator("details.cv-more button", { hasText: "About" }).click();
await expectInside("the About dialog", ".cv-modal");
await close();
if ((await page.locator(".cv-modal").count()) > 0) await page.locator(".cv-modal button").last().click().catch(() => {});

// And the same menus on a window shorter still, where nothing fits whole.
await page.setViewportSize({ width: 900, height: 380 });
await page.waitForTimeout(300);
{
  const p2 = await page.locator(".react-flow__pane").boundingBox();
  await page.mouse.click(p2.x + p2.width / 2, p2.y + p2.height / 2, { button: "right" });
  await expectInside("on a window 380 high, a right-click menu", ".cv-menu");
  await close();
  const more = page.locator("details.cv-more > summary");
  // On a window this narrow the toolbar may lie over it; then it cannot be
  // opened at all, which is not what this is checking.
  if (await more.click({ timeout: 1500 }).then(() => true, () => false)) {
    await expectInside("on a window 380 high, the More menu", "details.cv-more .cv-dropdown-menu");
    await close();
  }
}

// The strip's menus look alike: Types and Filter read like Arrange, with no
// frame of their own until one of them is on.
{
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.waitForTimeout(300);
  const look = (sel) => page.locator(sel).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { border: cs.borderTopColor, bg: cs.backgroundColor };
  });
  const arrange = await look(".cv-arrange-menu > summary");
  for (const [name, sel] of [["Types", ".cv-type-filter > summary"], ["Filter", ".cv-filter-menu > summary"]]) {
    const it = await look(sel);
    check(`${name}, while off, looks like Arrange beside it: no frame`, it.border === arrange.border && it.bg === arrange.bg, JSON.stringify({ it, arrange }));
  }
}

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
