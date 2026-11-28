// The page tabs, used the way a person uses them: a name typed with spaces
// in it, a tab dragged to another place, a page removed from its menu, and
// that menu on top of whatever is under the strip.
//
//     npm run dev            # in another terminal
//     node e2e/pagetabs.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const canvas = { gridEnabled: false, snapEnabled: false, minimap: false, nodeStyle: "glyph" };
const pageOf = (id, name) => ({ id, name, canvas, nodes: [], edges: [] });
const project = {
  meta: { id: "tabs", name: "Tabs", customer: "", site: "", createdAt: NOW, updatedAt: NOW },
  document: { activePageId: "p1", probes: [], pages: [pageOf("p1", "Overview"), pageOf("p2", "Branch"), pageOf("p3", "Notes"), pageOf("p4", "Spare")] },
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
await page.addInitScript(({ p }) => {
  // The dock open under the strip, which is where the menu used to go.
  localStorage.setItem("corelens.view.panelOpen", "1");
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback() { return next++; },
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
page.on("pageerror", (e) => { failures++; console.log("PAGE EXCEPTION:", String(e).slice(0, 300)); });
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(900);

const st = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(250);
const names = () => st(() => window.__cvStore.getState().doc.pages.map((p) => p.name).join(" | "));
const active = () => st(() => { const d = window.__cvStore.getState().doc; return d.pages.find((p) => p.id === d.activePageId).name; });
const tab = (name) => page.locator(".cv-page-tab", { hasText: name }).first();
const shown = () => page.locator(".cv-page-tab").evaluateAll((els) => els.map((e) => (e.querySelector("input")?.value ?? e.textContent).trim()).join(" | "));
const middle = async (locator) => { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
// Whether each entry of the open menu is the thing a click at its middle would reach.
const menuOnTop = () => st(() => [...document.querySelectorAll(".cv-menu button")].map((b) => {
  const r = b.getBoundingClientRect();
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { label: b.textContent.trim(), reached: at === b || b.contains(at), inWindow: r.top >= 0 && r.bottom <= innerHeight };
}));

check("(the fixture: four pages, the dock open under the strip)", (await names()) === "Overview | Branch | Notes | Spare" && (await page.locator(".cv-panel").count()) > 0, await names());

// ------------------------------------------------------- a name with spaces
await tab("Branch").dblclick();
await settle();
await page.keyboard.press("Control+a");
await page.keyboard.type("Core network east");
await page.keyboard.press("Enter");
await settle();
check("a name is typed with its spaces", (await names()) === "Overview | Core network east | Notes | Spare", await names());
check("and the tab shows it", (await shown()) === "Overview | Core network east | Notes | Spare", await shown());

await tab("Notes").dblclick();
await settle();
await page.keyboard.press("Control+a");
await page.keyboard.type("Thrown away");
await page.keyboard.press("Escape");
await settle();
check("Escape leaves the name as it was", (await names()) === "Overview | Core network east | Notes | Spare", await names());

await tab("Notes").dblclick();
await settle();
await page.keyboard.press("Control+a");
await page.keyboard.press("Backspace");
await page.keyboard.press("Enter");
await settle();
check("a blank name is refused", (await names()) === "Overview | Core network east | Notes | Spare", await names());

await tab("Notes").dblclick();
await settle();
await page.keyboard.press("Control+a");
await page.keyboard.type("  Site notes  ");
// Somewhere else pressed: the name is kept, without the spaces round it.
const desk = await page.locator(".react-flow__pane").boundingBox();
await page.mouse.click(desk.x + 200, desk.y + 120);
await settle();
check("a press elsewhere keeps the name, trimmed at its ends only", (await names()) === "Overview | Core network east | Site notes | Spare", await names());

// ------------------------------------------------------ a tab dragged along
{
  const from = await middle(tab("Overview"));
  const to = await page.locator(".cv-page-tab", { hasText: "Site notes" }).first().boundingBox();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y, { steps: 3 });
  await page.mouse.move(to.x + to.width - 4, from.y, { steps: 8 });
  await settle();
  check("while a tab is dragged, where it will go is marked", (await page.locator(".cv-page-tab.is-drop-after, .cv-page-tab.is-drop-before").count()) === 1);
  await page.mouse.up();
  await settle();
  check("a tab dragged past two others is the third page", (await names()) === "Core network east | Site notes | Overview | Spare", await names());
  check("and nothing of the drag is left on the strip", (await page.locator(".cv-page-tab.is-drop-after, .cv-page-tab.is-drop-before, .cv-page-tab.is-dragging").count()) === 0);
  await page.keyboard.press("Control+z");
  await settle();
  check("one undo puts it back", (await names()) === "Overview | Core network east | Site notes | Spare", await names());
}
{
  // A press and release without a move is a click, not a drag.
  const at = await middle(tab("Spare"));
  await page.mouse.click(at.x, at.y);
  await settle();
  check("a click on a tab opens its page", (await active()) === "Spare", await active());
  check("and moves nothing", (await names()) === "Overview | Core network east | Site notes | Spare", await names());
}

// ------------------------------------------------------------ the tab's menu
await tab("Site notes").click({ button: "right" });
await settle();
{
  const entries = await menuOnTop();
  check("a tab's menu offers to rename, duplicate, move and delete",
    ["Rename", "Duplicate", "Move left", "Move right", "Delete"].every((l) => entries.some((e) => e.label === l)), entries.map((e) => e.label).join(", "));
  const hidden = entries.filter((e) => !e.reached || !e.inWindow);
  check("every entry is on top of what is under the strip, and inside the window", entries.length > 0 && hidden.length === 0, JSON.stringify(hidden));
  await page.locator(".cv-menu button", { hasText: /^Move left$/ }).click();
  await settle();
  check("Move left moves the page one place", (await names()) === "Overview | Site notes | Core network east | Spare", await names());
}
await tab("Site notes").click({ button: "right" });
await settle();
await page.locator(".cv-menu button", { hasText: /^Rename$/ }).click();
await settle();
await page.keyboard.press("Control+a");
await page.keyboard.type("Site notes 2");
await page.keyboard.press("Enter");
await settle();
check("Rename from the menu opens the name to be typed", (await names()) === "Overview | Site notes 2 | Core network east | Spare", await names());

await tab("Spare").click({ button: "right" });
await settle();
await page.locator(".cv-menu button", { hasText: /^Delete$/ }).click();
await settle();
check("Delete from the menu removes the page", (await names()) === "Overview | Site notes 2 | Core network east", await names());
await page.keyboard.press("Control+z");
await settle();
check("and one undo brings it back", (await names()) === "Overview | Site notes 2 | Core network east | Spare", await names());

// The last page cannot be removed.
await st(() => { const s = window.__cvStore.getState(); for (const id of ["p2", "p3", "p4"]) s.removePage(id); });
await settle();
await tab("Overview").click({ button: "right" });
await settle();
check("the only page left cannot be deleted", await page.locator(".cv-menu button", { hasText: /^Delete$/ }).isDisabled());
await page.keyboard.press("Escape");
await settle();

// ----------------------------------------------------------- the keyboard
await st(() => { const s = window.__cvStore.getState(); s.addPage("Second"); s.addPage("Third"); s.setActivePage("p1"); });
await settle();
await tab("Overview").focus();
await page.keyboard.press("ArrowRight");
await settle();
check("the arrow keys go from tab to tab", (await active()) === "Second", await active());
await page.keyboard.press("F2");
await settle();
await page.keyboard.press("Control+a");
await page.keyboard.type("Second floor");
await page.keyboard.press("Enter");
await settle();
check("F2 renames the tab the keyboard is on", (await names()) === "Overview | Second floor | Third", await names());
check("and the keyboard is back on it", await st(() => document.activeElement?.classList.contains("cv-page-tab") && document.activeElement.textContent.includes("Second floor")));
await page.keyboard.press("Alt+ArrowRight");
await settle();
check("Alt and an arrow move the page", (await names()) === "Overview | Third | Second floor", await names());

// ------------------------------------------- the ends of the strip stay put
{
  await st(() => { const s = window.__cvStore.getState(); for (let i = 0; i < 24; i++) s.addPage(`Drawing number ${i} of the set`); });
  await settle();
  const ends = await st(() => {
    const strip = document.querySelector(".cv-page-tabs").getBoundingClientRect();
    const seen = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.left >= strip.left - 1 && r.right <= strip.right + 1 && (at === document.querySelector(sel) || document.querySelector(sel).contains(at)); };
    return { add: seen(".cv-page-tab-add"), all: seen(".cv-page-nav-toggle") };
  });
  check("with more pages than fit, Add a page and All pages are still there to press", ends.add && ends.all, JSON.stringify(ends));
  await page.locator(".cv-page-nav-toggle").click();
  await settle();
  const nav = await st(() => {
    const el = document.querySelector(".cv-page-nav");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    return { onTop: el.contains(at), inWindow: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
  });
  check("and the list of all pages opens over the drawing, whole", nav?.onTop && nav.inWindow, JSON.stringify(nav));
  await page.keyboard.press("Escape");
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
