// What a drag draws goes when the drag is over, however it ended. Alignment
// guides:
// a mouse drag let go, and a touch drag that React Flow abandoned when a
// second finger came down (it sends the last position with `dragging: false`
// and never calls its drag-stop handler). A guide left behind stays on the
// canvas as a thin line, or a dot where it was short, until the app restarts.
// And a link's end dragged round a device: a gesture the system takes over
// ends in `pointercancel`, not `pointerup`, and the end, its port dots and its
// snap ring must not go on following the pointer.
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const dev = (id, label, x, y) => ({
  id, type: "device", position: { x, y }, width: 76, height: 76,
  data: { label, deviceType: "access-switch", tags: [], addresses: [], locked: false, maintenance: false, showDetails: false },
});

const project = {
  meta: { id: "gd", name: "Guides", customer: "", site: "", ticket: "", engineer: "", description: "", createdAt: NOW, updatedAt: NOW, archived: false },
  documentVersion: 1,
  document: {
    nodes: [dev("a", "ANCHOR-A", 0, 0), dev("b", "ANCHOR-B", 300, 0), dev("m", "MOVER", 600, 160)],
    edges: [{
      id: "e1", source: "a", target: "b", sourceHandle: "b", targetHandle: "t", type: "live",
      data: { sourcePortLabel: "", targetPortLabel: "", label: "", pathType: "straight", direction: "none", width: 2, color: "#7c8fa3", enabled: true, maintenance: false, lineStyle: "solid", healthRule: { type: "manual", manualStatus: "unknown" } },
    }],
    probes: [], canvas: {},
  },
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, hasTouch: true });
const page = await context.newPage();
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
await page.waitForTimeout(900);

const named = (label) => page.locator(".react-flow__node", { hasText: label }).first();
const guides = () => page.locator(".cv-guide").count();
const cdp = await context.newCDPSession(page);
const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });

/** Drags MOVER by touch until it sits level with the anchors. */
async function touchIntoLine() {
  const anchor = await named("ANCHOR-A").boundingBox();
  const m = await named("MOVER").boundingBox();
  let at = [m.x + 38, m.y + 38];
  await touch("touchStart", [at]);
  const goal = anchor.y + 38 + 3;
  for (let i = 1; i <= 15; i++) {
    at = [m.x + 38 - i * 4, m.y + 38 + ((goal - (m.y + 38)) * i) / 15];
    await touch("touchMove", [at]);
    await page.waitForTimeout(16);
  }
  // Measured and corrected: the drag starts only past a threshold, so
  // the device trails the finger.
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(100);
    const now = await named("MOVER").boundingBox();
    const dy = anchor.y + 2 - now.y;
    if (Math.abs(dy) < 1) break;
    at = [at[0], at[1] + dy];
    await touch("touchMove", [at]);
  }
  await page.waitForTimeout(200);
  return at;
}

// --- a touch drag abandoned by a second finger --------------------------
{
  const at = await touchIntoLine();
  check("a guide shows while the device is level with others", (await guides()) >= 1, `${await guides()} guides`);
  // A second finger: React Flow abandons the drag.
  await touch("touchMove", [[at[0] + 2, at[1]], [at[0] + 200, at[1] + 120]]);
  await page.waitForTimeout(30);
  await touch("touchEnd", []);
  await page.waitForTimeout(500);
  check("no guide is left when a second finger ends the drag", (await guides()) === 0, `${await guides()} left`);
}

// --- a mouse drag let go -------------------------------------------------
{
  const anchor = await named("ANCHOR-B").boundingBox();
  const m = await named("MOVER").boundingBox();
  await page.mouse.move(m.x + 38, m.y + 38);
  await page.mouse.down();
  await page.mouse.move(m.x + 38 + 40, anchor.y + 38 + 140, { steps: 10 });
  await page.mouse.move(m.x + 38 + 60, anchor.y + 38 + 2, { steps: 12 });
  await page.waitForTimeout(200);
  check("a guide shows on a mouse drag", (await guides()) >= 1);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("and goes when the mouse is let go", (await guides()) === 0, `${await guides()} left`);
}

// --- the window losing the pointer mid-drag -------------------------------
{
  const anchor = await named("ANCHOR-A").boundingBox();
  const m = await named("MOVER").boundingBox();
  await page.mouse.move(m.x + 38, m.y + 38);
  await page.mouse.down();
  await page.mouse.move(m.x + 38 + 30, anchor.y + 38 + 120, { steps: 8 });
  let py = anchor.y + 38 + 2;
  await page.mouse.move(m.x + 38 + 50, py, { steps: 10 });
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(100);
    const dy = anchor.y + 2 - (await named("MOVER").boundingBox()).y;
    if (Math.abs(dy) < 1) break;
    py += dy;
    await page.mouse.move(m.x + 38 + 50, py, { steps: 2 });
  }
  await page.waitForTimeout(150);
  check("a guide shows before the window loses focus", (await guides()) >= 1, `${await guides()}`);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(300);
  check("no guide outlives the window losing focus", (await guides()) === 0, `${await guides()} left`);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

// --- a link's end, its drag cancelled -----------------------------------------
{
  // The diagram is fitted first: the drag above, held near the canvas's
  // edge, scrolls the canvas by as much as its timing allows, which can
  // leave the whole link off the screen. Then a point of the link that is
  // in the open: its middle may lie under the shape palette, where a click
  // lands on the palette.
  await page.evaluate(() => window.__cvStore.getState().requestFit());
  await page.waitForTimeout(600);
  const open = await page.evaluate(() => {
    const path = document.querySelector('.cv-edge-hit path[data-id="e1"]');
    const len = path.getTotalLength();
    const m = path.getScreenCTM();
    for (let i = 39; i >= 1; i--) {
      const p = path.getPointAtLength((len * i) / 40);
      const at = { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
      if (document.elementFromPoint(at.x, at.y) === path) return at;
    }
    return null;
  });
  check("the link has a point in the open to click", open !== null);
  await page.mouse.click(open.x, open.y);
  await page.waitForTimeout(300);
  const handles = page.locator(".cv-edge-endpoint");
  check("a selected link shows its end handles", (await handles.count()) >= 2, `${await handles.count()}`);
  const h = await handles.nth(1).boundingBox();
  const target = await named("MOVER").boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 4, { steps: 14 });
  await page.waitForTimeout(150);
  const during = await page.locator(".cv-connection-snap").count();
  check("dragging the end onto a device snaps it there", during >= 1, `${during}`);
  // The system takes the gesture: no pointerup ever comes.
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1, pointerType: "mouse" })));
  await page.waitForTimeout(200);
  check("a cancelled drag takes its snap ring away", (await page.locator(".cv-connection-snap").count()) === 0, `${await page.locator(".cv-connection-snap").count()} left`);
  check("and its port dots", (await page.locator(".cv-port-ticks").count()) === 0);
  const before = await page.locator('.react-flow__edge[data-id="e1"] .react-flow__edge-path').first().getAttribute("d");
  await page.mouse.move(200, 700, { steps: 6 });
  await page.waitForTimeout(150);
  const after = await page.locator('.react-flow__edge[data-id="e1"] .react-flow__edge-path').first().getAttribute("d");
  check("and the end no longer follows the pointer", before === after, `${before} -> ${after}`);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const e1 = await page.evaluate(() => { const d = window.__cvStore.getState().doc; return (d.pages ? Object.values(d.pages).flatMap((p) => p.edges ?? []) : d.edges).find((e) => e.id === "e1"); });
  check("the link stays where it was", e1?.source === "a" && e1?.target === "b", JSON.stringify({ s: e1?.source, t: e1?.target }));
}

// --- nothing drawn as a dot ------------------------------------------------
{
  const sizes = await page.locator(".cv-guide").evaluateAll((els) => els.map((e) => [e.offsetWidth, e.offsetHeight]));
  check("no guide is ever a dot", sizes.every(([w, h]) => w > 2 || h > 2), JSON.stringify(sizes));
}

await browser.close();
console.log(failures ? `\n${failures} failed` : "\nall ok");
process.exit(failures ? 1 : 0);
