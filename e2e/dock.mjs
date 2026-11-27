// The dock — the same tabs grouped by what they answer, the job
// strip along its bottom with the clock, and Pop out, which sends it down the
// right of the window and is remembered. Stubbed backend; the dock is window
// state and touches nothing behind the bridge.
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
  data: { label, deviceType: "access-switch", tags: [], addresses: [{ id: `${id}-a`, label: "Discovered", address: "192.0.2.10", isPrimary: true }], locked: false, maintenance: false, showDetails: true },
});

const project = {
  meta: { id: "dock", name: "Dock", customer: "", site: "", ticket: "", engineer: "", description: "", createdAt: NOW, updatedAt: NOW, archived: false },
  documentVersion: 1,
  document: {
    nodes: [device("n1", "CORE-SW1", 0, 0), device("n2", "ACCESS-SW7", 0, 300)],
    edges: [],
    probes: [],
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
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(String(e).slice(0, 300)); console.log("PAGE EXCEPTION:", String(e).slice(0, 300)); });
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(700);

const st = (fn, arg) => page.evaluate(fn, arg);
const box = (sel) => page.locator(sel).first().boundingBox();

// ------------------------------------------------------------- the groups

const groups = page.locator(".cv-panel .cv-tabs .cv-tab-group");
check("the tabs sit in four groups", (await groups.count()) === 4, `${await groups.count()}`);
const names = await page.locator(".cv-tab-group-name").allTextContents();
check("named Monitor, Discover, Paths and Ops, in that order",
  JSON.stringify(names) === JSON.stringify(["Monitor", "Discover", "Paths", "Ops"]), names.join(" | "));

const under = async (group) => page.locator(`.cv-tab-group[data-group="${group}"] button[role="tab"]`).allInnerTexts();
check("Monitor holds the objects, the timeline and Compare runs, with their counts",
  JSON.stringify(await under("monitor")) === JSON.stringify(["Monitored objects (2)", "Event timeline (0)", "Compare runs"]), (await under("monitor")).join(" | "));
// Collect is under Discover devices ▸ Advanced now.
check("Discover holds the crawler and the ping sweep",
  JSON.stringify(await under("discover")) === JSON.stringify(["Discover devices", "Ping sweep"]), (await under("discover")).join(" | "));
check("Paths holds the four answers to where it goes",
  JSON.stringify(await under("paths")) === JSON.stringify(["Path-Trace", "Path check", "Tracert", "Where is"]), (await under("paths")).join(" | "));
check("Ops holds Backups, SSH and the Console",
  JSON.stringify(await under("ops")) === JSON.stringify(["Backups", "SSH", "Console"]), (await under("ops")).join(" | "));
check("every tab is there exactly once", (await page.locator('.cv-panel button[role="tab"]').count()) === 12);

// the arrows still walk the tabs, past the group headings.
await page.locator('.cv-panel button[role="tab"]', { hasText: "Monitored objects" }).focus();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);
check("the right arrow moves to the timeline", (await st(() => window.__cvStore.getState().dockTab)) === "events");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);
check("then to Compare runs", (await st(() => window.__cvStore.getState().dockTab)) === "compare");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);
check("and on into the next group", (await st(() => window.__cvStore.getState().dockTab)) === "crawl");
check("which the rail marks as Discover", (await page.locator(".cv-nav-item.is-current").innerText()) === "Discover");
await page.keyboard.press("End");
await page.waitForTimeout(150);
check("End reaches the Console, the last tab", (await st(() => window.__cvStore.getState().dockTab)) === "console");
await page.locator('.cv-panel button[role="tab"]', { hasText: "Monitored objects" }).click();
await page.waitForTimeout(150);

// ------------------------------------------------------------- the strip

check("the strip runs along the dock's bottom",
  (await box(".cv-panel .cv-dock-strip")).y > (await box(".cv-panel-body")).y);
// The clock lives in the top bar now, in sight on every screen; the strip is the jobs' line.
const clock = page.locator(".cv-topbar .cv-clock");
const dtg = await clock.innerText();
check("with the clock in the DTG the setting starts on", /^\d{6}Z [A-Z]{3} \d{2}$/.test(dtg), dtg);
await st(() => window.__cvStore.getState().setSettings({ timeFormat: "local-24" }));
await page.waitForTimeout(150);
const local = await clock.innerText();
check("and the clock follows Settings ▸ Times", local !== dtg && /\d{2}:\d{2}/.test(local), local);
await st(() => window.__cvStore.getState().setSettings({ timeFormat: "dtg-zulu" }));

check("no job, no job line", (await page.locator(".cv-dock-strip .cv-job").count()) === 0);
await st(() => window.__cvStore.getState().setJobs([{ id: 7, kind: "backup", state: "running", phase: "saving", done: 2, total: 5, startedMs: Date.now() - 5000 }]));
await page.waitForTimeout(200);
const line = page.locator(".cv-dock-strip .cv-job");
check("a running job shows in the strip", (await line.count()) === 1);
check("with what it is and how far it has got", /Backup.*2 of 5/.test(await line.innerText()), await line.innerText());
check("and Cancel", (await line.locator("button", { hasText: "Cancel" }).count()) === 1);
check("the top bar does not repeat it while the dock is in sight", (await page.locator(".cv-topbar .cv-jobs").count()) === 0);

await page.locator(".cv-nav-item", { hasText: /^Inventory$/ }).click();
await page.waitForTimeout(300);
check("a screen over the dock puts the job line in the top bar instead", (await page.locator(".cv-topbar .cv-jobs .cv-job").count()) === 1);
await page.locator(".cv-nav-item", { hasText: /^Diagram$/ }).click();
await page.waitForTimeout(300);
check("and back", (await page.locator(".cv-topbar .cv-jobs").count()) === 0 && (await line.count()) === 1);
// Diagram on the rail is the diagram alone: the dock is folded to its strip.
check("Diagram on the rail folds the dock, the job line still in its strip", (await page.locator(".cv-panel.is-collapsed .cv-dock-strip .cv-job").count()) === 1);
await page.locator(".cv-panel.is-collapsed button", { hasText: "Show status and events" }).click();
await page.waitForTimeout(250);

await page.locator(".cv-panel button", { hasText: /^Hide$/ }).click();
await page.waitForTimeout(250);
check("folded away, the dock still shows the strip", (await page.locator(".cv-panel.is-collapsed .cv-dock-strip .cv-job").count()) === 1);
await page.locator(".cv-panel.is-collapsed button", { hasText: "Show status and events" }).click();
await page.waitForTimeout(250);
await st(() => window.__cvStore.getState().setJobs([]));

// --------------------------------------------- not checked, and the counts
{
  await page.locator('.cv-panel button[role="tab"]', { hasText: "Monitored objects" }).click();
  await page.waitForTimeout(300);
  // This project has never been checked, so the list says so.
  check("before any check has run, the list says so",
    (await page.locator(".cv-nocheck").count()) === 1 && /Checks have not run/.test(await page.locator(".cv-nocheck").innerText()));
  check("with Start checks on the banner", (await page.locator('[data-region="banner-start-checks"]').count()) === 1);
  // Not checked reads as the word, not "Unknown".
  check("the rows read Not checked, not Unknown",
    (await page.locator(".cv-targets .cv-status-chip.is-unknown").first().innerText()).includes("Not checked"));
  // The top bar's health counts are buttons into the list.
  const notChecked = page.locator('.cv-topbar [data-region="count-unknown"]');
  check("the top bar counts the two as not checked", /2/.test(await notChecked.innerText()) && (await notChecked.getAttribute("title")) === "Show the Not checked list");
  // Down count opens the list filtered to Down.
  await page.locator('.cv-topbar [data-region="count-down"]').click();
  await page.waitForTimeout(300);
  check("clicking the Down count opens the list filtered to Down",
    (await st(() => window.__cvStore.getState().dockTab)) === "objects" &&
    (await page.locator('.cv-panel-seg button.is-on').innerText()) === "Down");
  // Up relabelled from Healthy.
  check("the Up count carries the new word", (await page.locator('.cv-topbar [data-region="count-healthy"]').getAttribute("title")) === "Show the Up list");
  await page.locator('.cv-panel-seg button', { hasText: "All" }).click();
  await page.waitForTimeout(200);
}

// ------------------------------------------------------------- pop out

const side = page.locator('[data-action="dock-side"]');
check("on a wide-table tab the dock offers to dock to the right", (await side.innerText()) === "Dock to the right");
const below = { panel: await box(".cv-panel"), canvas: await box(".cv-canvas") };
check("and starts along the bottom, under the canvas", below.panel.y >= below.canvas.y + below.canvas.height - 1,
  JSON.stringify(below));
await side.click();
await page.waitForTimeout(400);
const right = { panel: await box(".cv-panel"), canvas: await box(".cv-canvas"), inspector: await box(".cv-inspector"), main: await box(".cv-main") };
check("Pop out puts the dock down the right of the window",
  right.panel.x >= right.canvas.x + right.canvas.width && right.panel.x + right.panel.width >= 1498, JSON.stringify(right));
check("the full height of the body", right.panel.height > 800, `${right.panel.height}`);
check("without the inspector running under it", right.inspector.x + right.inspector.width <= right.panel.x + 1, JSON.stringify(right));
check("and the button now reads Dock below", (await side.innerText()) === "Dock below");
check("the tabs still answer", (await page.locator('.cv-panel button[role="tab"]').count()) === 12);

// F5 hides the dock wherever it is.
await page.locator(".react-flow__pane").click({ position: { x: 60, y: 60 } });
await page.keyboard.press("F5");
await page.waitForTimeout(300);
check("presenting hides the popped-out dock", (await page.locator(".cv-panel").isVisible()) === false);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("and Escape brings it back where it was", (await page.locator(".cv-panel").isVisible()) === true && (await box(".cv-panel")).x > 800);

// Remembered on this machine, like the panels.
await page.reload({ waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(700);
if (await page.locator(".cv-recovery").count()) {
  await page.locator(".cv-recovery button", { hasText: "Keep what was saved" }).click();
  await page.waitForTimeout(300);
}
check("the side is remembered across a reopen", (await box(".cv-panel")).x > 800 && (await side.innerText()) === "Dock below");
await side.click();
await page.waitForTimeout(400);
const back = { panel: await box(".cv-panel"), canvas: await box(".cv-canvas") };
check("Dock below puts it back under the canvas", back.panel.y >= back.canvas.y + back.canvas.height - 1 && back.panel.width > 1200,
  JSON.stringify(back));
check("and that is remembered too, keyed by the tab",
  (await st(() => JSON.parse(localStorage.getItem("corelens.view.dockPlacements") ?? "{}"))).objects === "bottom");

// ---------------------------------------------- a window of its own
// The dock moved into a second window: the same panel, drawn from the same
// state, with the main window's room given back to the diagram.
{
  const canvasBefore = await box(".cv-canvas");
  const [dock] = await Promise.all([
    page.context().waitForEvent("page"),
    page.locator('[data-action="dock-window"]').click(),
  ]);
  await dock.waitForSelector(".cv-panel.is-detached", { timeout: 5000 });
  await page.waitForTimeout(400);
  check("the dock opens in a window of its own", (await dock.locator(".cv-panel.is-detached").count()) === 1);
  check("and leaves the main window", (await page.locator(".cv-panel").count()) === 0);
  const canvasAfter = await box(".cv-canvas");
  check("whose diagram takes the room it had", canvasAfter.height > canvasBefore.height + 100 || canvasAfter.width > canvasBefore.width + 100,
    JSON.stringify({ before: canvasBefore, after: canvasAfter }));
  const look = await dock.evaluate(() => {
    const panel = document.querySelector(".cv-panel");
    const r = panel.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, bg: cs.backgroundColor, font: getComputedStyle(document.body).fontFamily,
      sheets: document.querySelectorAll("style, link[rel=stylesheet]").length, title: document.title };
  });
  const mainBg = await page.evaluate(() => { const e = document.createElement("i"); e.style.color = "var(--chrome)"; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; });
  check("it fills its window", look.w >= look.vw - 1 && look.h >= look.vh - 1, JSON.stringify(look));
  check("dressed in the application's own stylesheet", look.sheets > 0 && look.bg === mainBg, JSON.stringify({ bg: look.bg, mainBg, sheets: look.sheets }));
  check("and named for the project", /Corelens Desktop/.test(look.title) && /Dock/.test(look.title), look.title);
  check("every tab is there", (await dock.locator('.cv-panel button[role="tab"]').count()) === 12);

  // One program, one state: a click in that window is a change in this one.
  await dock.locator('.cv-panel button[role="tab"]', { hasText: "Event timeline" }).click();
  await page.waitForTimeout(300);
  check("a tab chosen there is the tab the application is on", (await st(() => window.__cvStore.getState().dockTab)) === "events");
  await dock.locator('.cv-panel button[role="tab"]', { hasText: /^Monitored objects/ }).click();
  await dock.waitForTimeout(300);
  check("the monitored objects are listed there", (await dock.locator(".cv-panel tr", { hasText: "CORE-SW1" }).count()) >= 1);
  await dock.locator(".cv-panel tr", { hasText: "ACCESS-SW7" }).first().click();
  await page.waitForTimeout(400);
  check("and choosing a row there selects the device on the diagram here",
    (await st(() => window.__cvStore.getState().selectedNodeId)) === "n2", String(await st(() => window.__cvStore.getState().selectedNodeId)));
  // …and a change made here is drawn there.
  await st(() => window.__cvStore.getState().updateNodeData("n1", { label: "CORE-RENAMED" }));
  await dock.waitForTimeout(400);
  check("a device renamed in the main window is renamed in the dock's", (await dock.locator(".cv-panel tr", { hasText: "CORE-RENAMED" }).count()) >= 1);

  // Other screens do not take a detached dock away.
  check("the side and hide buttons give way to the one that brings it back",
    (await dock.locator('[data-action="dock-side"]').count()) === 0 && (await dock.locator('[data-action="dock-window"]').getAttribute("aria-pressed")) === "true");

  await dock.locator('[data-action="dock-window"]').click();
  await page.waitForTimeout(600);
  check("the button there brings the dock back", (await page.locator(".cv-panel").count()) === 1 && (await st(() => window.__cvStore.getState().dockDetached)) === false);
  check("and its window closes", dock.isClosed());

  // Closing the window itself is the other way back.
  const [again] = await Promise.all([
    page.context().waitForEvent("page"),
    page.locator('[data-action="dock-window"]').click(),
  ]);
  await again.waitForSelector(".cv-panel.is-detached", { timeout: 5000 });
  await again.close();
  await page.waitForTimeout(900);
  check("closing the dock's window puts the dock back in the main one",
    (await page.locator(".cv-panel").count()) === 1 && (await st(() => window.__cvStore.getState().dockDetached)) === false);
  check("and nothing was thrown on the way", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));
}

// One tab that fails does not take the others with it. The stub answers the
// sweep's subnet question with nothing it can use, which is enough to break
// that one tab.
{
  await st(() => { const s = window.__cvStore.getState(); s.setPanelOpen(true); s.requestPanelTab("discover"); });
  await page.waitForTimeout(700);
  const broke = (await page.locator(".cv-panel .cv-boundary").filter({ hasText: /stopped working/ }).count()) > 0;
  check("(the fixture breaks the Ping sweep tab)", broke);
  const strip = page.locator('.cv-panel button[role="tab"]');
  check("the tab strip is still there", (await strip.count()) > 3, String(await strip.count()));
  await strip.filter({ hasText: /^Backups/ }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  check("and another tab opens and works",
    (await st(() => window.__cvStore.getState().dockTab)) === "backup" && (await page.locator(".cv-panel").filter({ hasText: /stopped working/ }).count()) === 0);
}

await browser.close();
if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall dock checks passed");
