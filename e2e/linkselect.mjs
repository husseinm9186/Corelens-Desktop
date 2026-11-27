// Several links selected at once: a selection box or a lasso catches the
// links it is drawn across, with no device in it; Ctrl+click adds one or
// takes it away; Delete, or the right-click menu, removes them together and
// one undo brings them back.
//
//     npm run dev            # in another terminal
//     node e2e/linkselect.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = Date.now();

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const canvas = { gridEnabled: false, snapEnabled: false, minimap: false, nodeStyle: "glyph" };
const node = (id, x, y) => ({ id, type: "device", position: { x, y }, data: { label: id.toUpperCase(), deviceType: "access-switch", tags: [], addresses: [] } });
const link = (id, source, target) => ({ id, source, target, sourceHandle: "b", targetHandle: "t", type: "live",
  data: { sourcePortLabel: "", targetPortLabel: "", label: "", direction: "none", enabled: true, maintenance: false, pathType: "straight", healthRule: { type: "manual" } } });
const project = {
  meta: { id: "ls", name: "Links", customer: "", site: "", createdAt: NOW, updatedAt: NOW },
  document: { activePageId: "p1", probes: [], pages: [{ id: "p1", name: "Core", canvas,
    // Two columns: the links e1 and e2 run down them, far from any device
    // in the middle; e3 runs down a third, further right.
    nodes: [node("a", 0, 0), node("b", 260, 0), node("c", 0, 520), node("d", 260, 520), node("e", 620, 0), node("f", 620, 520)],
    edges: [link("e1", "a", "c"), link("e2", "b", "d"), link("e3", "e", "f")] }] },
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
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
await page.waitForTimeout(900);

const st = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(300);
const chosen = () => st(() => {
  const pg = window.__cvStore.getState().doc.pages[0];
  return { links: pg.edges.filter((e) => e.selected).map((e) => e.id).sort().join(","), devices: pg.nodes.filter((n) => n.selected).map((n) => n.id).sort().join(",") };
});
const links = () => st(() => window.__cvStore.getState().doc.pages[0].edges.map((e) => e.id).sort().join(","));
const message = () => st(() => window.__cvStore.getState().statusMessage ?? "");
// A point of a link's line that is in the open, on screen.
const onLink = (id, at = 0.5) => st(({ id, at }) => {
  const path = document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`);
  const p = path.getPointAtLength(path.getTotalLength() * at).matrixTransform(path.getScreenCTM());
  return { x: p.x, y: p.y };
}, { id, at });
const clear = async () => { await st(() => { const s = window.__cvStore.getState(); const pg = s.doc.pages[0]; s.onEdgesChange(pg.edges.filter((e) => e.selected).map((e) => ({ id: e.id, type: "select", selected: false }))); s.onNodesChange(pg.nodes.filter((n) => n.selected).map((n) => ({ id: n.id, type: "select", selected: false }))); s.select(null, null); }); await settle(); };

// ----------------------------------------------------- the selection box
const one = await onLink("e1"), two = await onLink("e2"), three = await onLink("e3");
check("(the fixture: the two links run side by side, a third further off)", two.x - one.x > 100 && three.x - two.x > 150, JSON.stringify([one, two, three]));
await page.mouse.move(one.x - 60, one.y - 40);
await page.mouse.down();
await page.mouse.move(one.x + 20, one.y, { steps: 4 });
await page.mouse.move(two.x + 60, two.y + 40, { steps: 6 });
await settle();
check("while the box is drawn, the links it crosses are marked", (await page.locator(".react-flow__edge.is-caught").count()) === 2, String(await page.locator(".react-flow__edge.is-caught").count()));
await page.mouse.up();
await settle();
const boxed = await chosen();
check("a box drawn across two links, with no device in it, selects the two", boxed.links === "e1,e2" && boxed.devices === "", JSON.stringify(boxed));
check("and the mark it drew with is gone", (await page.locator(".react-flow__edge.is-caught").count()) === 0);
check("the status line says how many, and how to remove them", /2 links selected/.test(await message()), await message());
check("the details panel says so too", /2 links selected/.test(await page.locator(".cv-inspector").innerText()), (await page.locator(".cv-inspector").innerText()).slice(0, 80));
check("no link shows its edit handles while several are selected", (await page.locator(".cv-edge-endpoint").count()) === 0, String(await page.locator(".cv-edge-endpoint").count()));

await page.keyboard.press("Delete");
await settle();
check("Delete removes them together and leaves the rest", (await links()) === "e3", await links());
await page.keyboard.press("Control+z");
await settle();
check("and one undo brings them all back", (await links()) === "e1,e2,e3", await links());
await clear();

// ------------------------------------------------------------ Ctrl+click
{
  const a = await onLink("e1"), b = await onLink("e2");
  await page.mouse.click(a.x, a.y);
  await settle();
  check("a click selects one link, and it shows its handles", (await chosen()).links === "e1" && (await page.locator(".cv-edge-endpoint").count()) >= 2, JSON.stringify(await chosen()));
  await page.keyboard.down("Control");
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up("Control");
  await settle();
  check("Ctrl+click adds another", (await chosen()).links === "e1,e2", JSON.stringify(await chosen()));
  await page.keyboard.down("Control");
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up("Control");
  await settle();
  check("and Ctrl+click on it again takes it away", (await chosen()).links === "e1", JSON.stringify(await chosen()));
  await page.keyboard.down("Control");
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up("Control");
  await settle();

  // ------------------------------------------------- the right-click menu
  await page.mouse.click(b.x, b.y, { button: "right" });
  await settle();
  const item = page.locator(".cv-menu button", { hasText: "Delete 2 selected links" });
  check("a right-click on one of several offers to delete them all", (await item.count()) === 1, (await page.locator(".cv-menu").innerText().catch(() => "")).slice(0, 120));
  check("and they are still selected", (await chosen()).links === "e1,e2", JSON.stringify(await chosen()));
  await item.click().catch(() => {});
  await settle();
  check("which removes them", (await links()) === "e3", await links());
  await page.keyboard.press("Control+z");
  await settle();
  await clear();
}

// ------------------------------------------------------------- the lasso
{
  const m = await onLink("e3");
  const loop = [{ x: m.x - 50, y: m.y - 40 }, { x: m.x + 50, y: m.y - 40 }, { x: m.x + 50, y: m.y + 40 }, { x: m.x - 50, y: m.y + 40 }, { x: m.x - 50, y: m.y - 30 }];
  await page.keyboard.down("Alt");
  await page.mouse.move(loop[0].x, loop[0].y);
  await page.mouse.down();
  for (const p of loop.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await settle();
  check("a lasso drawn across a link catches it", (await chosen()).links === "e3" && (await chosen()).devices === "", JSON.stringify(await chosen()));
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
