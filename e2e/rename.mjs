// An install from before the rename: its browser storage, its projects in
// browser mode and its undo history open under the current name.
//
// Storage is seeded under the earlier `coreview.` prefix and the earlier
// `coreview-history` database, as a webview profile carried across on the
// first start would hold it. Invented names only.
//
//     npm run dev            # in another terminal
//     node e2e/rename.mjs
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
  data: { label, deviceType: "router", tags: [], addresses: [], locked: false, maintenance: false, showDetails: false },
});
const pkg = (id, name) => ({
  meta: { id, name, customer: "", site: "", ticket: "", engineer: "", description: "",
    created_at: NOW, updated_at: NOW, archived: false },
  document_version: 1,
  document: { nodes: [device("n1", "LAB-ONE", 0, 0), device("n2", "LAB-TWO", 300, 0)], edges: [], probes: [], canvas: {} },
});

const browser = await chromium.launch();

// ---- Browser storage under the earlier prefix
{
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
  await page.addInitScript(({ project }) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    localStorage.setItem("coreview.projects.v1", JSON.stringify({ [project.meta.id]: project }));
    localStorage.setItem("coreview.view.uiScale", "1.25");
    localStorage.setItem("coreview.view.wheel", "scroll");
    localStorage.setItem("coreview.commentAuthor", "Lab Engineer");
  }, { project: pkg("old-browser", "Kept From Before") });
  await page.goto(URL, { waitUntil: "networkidle" });

  const listed = await page.locator(".cv-project-open", { hasText: "Kept From Before" }).count();
  check("a project kept under the earlier name is on the project screen", listed === 1, String(listed));
  const view = await page.evaluate(() => {
    const s = window.__cvStore.getState();
    return { uiScale: s.settings.uiScale, wheel: s.settings.wheel };
  });
  check("the view settings kept under the earlier name are the ones in use", view.uiScale === 1.25 && view.wheel === "scroll",
    JSON.stringify(view));
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  check("every key now sits under the current name, and none under the old one",
    keys.includes("corelens.view.uiScale") && keys.includes("corelens.commentAuthor") && keys.includes("corelens.projects.v1")
      && !keys.some((k) => k.startsWith("coreview.")), JSON.stringify(keys));

  // A setting changed after the move is not overwritten by anything left
  // over on the next start.
  await page.evaluate(() => localStorage.setItem("corelens.view.uiScale", "1"));
  await page.reload({ waitUntil: "networkidle" });
  const after = await page.evaluate(() => window.__cvStore.getState().settings.uiScale);
  check("a setting changed since stays changed across a restart", after === 1, String(after));
  await context.close();
}

// ---- Undo history in the earlier database
{
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
  await page.addInitScript(({ initial }) => {
    let next = 1;
    const saved = () => JSON.parse(sessionStorage.getItem("cv-saved") ?? "null") ?? initial;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback() { return next++; },
      invoke(cmd, args) {
        if (cmd === "plugin:event|listen") return Promise.resolve(next++);
        if (cmd === "save_project") {
          sessionStorage.setItem("cv-saved", JSON.stringify(args.package));
          return Promise.resolve(null);
        }
        if (cmd === "list_projects") return Promise.resolve([saved().meta]);
        if (cmd === "load_project") return Promise.resolve(saved());
        if (cmd === "get_settings") return Promise.resolve({});
        return Promise.resolve([]);
      },
    };
  }, { initial: pkg("old-history", "History From Before") });

  const open = async () => {
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.locator(".cv-project-open").first().click();
    await page.waitForTimeout(1200);
    if (await page.locator(".cv-recovery").count()) {
      await page.locator(".cv-recovery button", { hasText: "Keep what was saved" }).click();
    }
  };
  const state = () => page.evaluate(() => {
    const s = window.__cvStore.getState();
    return { past: s.past.length, label: s.doc.pages[0].nodes.find((n) => n.id === "n2").data.label };
  });

  await open();
  await page.evaluate(() => {
    const s = window.__cvStore.getState();
    for (let i = 1; i <= 3; i++) {
      s.commit();
      s.updateNodeData("n2", { label: `LAB-EDIT-${i}` });
    }
  });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1500);

  // Move what was kept into the database the earlier name used, and remove
  // the current one: the state a first start after the rename finds.
  const moved = await page.evaluate(async () => {
    const openDb = (name) => new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("projects");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const done = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    const now = await openDb("corelens-history");
    const kept = await done(now.transaction("projects").objectStore("projects").get("old-history"));
    now.close();
    if (!kept) return false;
    const old = await openDb("coreview-history");
    await done(old.transaction("projects", "readwrite").objectStore("projects").put(kept, "old-history"));
    old.close();
    await done(indexedDB.deleteDatabase("corelens-history"));
    return true;
  });
  check("the history was kept, and is now only under the earlier name", moved);

  await open();
  let st = await state();
  check("after the rename, the undo history kept under the earlier name is there", st.past === 3 && st.label === "LAB-EDIT-3",
    JSON.stringify(st));
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  st = await state();
  check("and undo carries on from it", st.label === "LAB-EDIT-2", JSON.stringify(st));
  await context.close();
}

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
