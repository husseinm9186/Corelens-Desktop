// Links meet a device on its ring, and stay there when an end is moved.
//
// What is checked, on the two-interconnects-and-a-chassis wiring from
// linkshots.mjs: every link end is on its device's ring; no two links at a
// device share an end; an orthogonal link has no slanted run; an end dragged
// by its handle slides round the ring and lands on it; an end dragged onto
// another device lands on that device's ring.
//
//     npm run dev
//     node e2e/ringends.mjs [outdir]
import { fixture, launch, open } from "./linkshots.mjs";

const out = process.argv[2] ?? null;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const browser = await launch();

/** Each link's plain geometry, read from the page: its ends, and whether
 *  every straight run is horizontal or vertical. */
const links = (page) => page.evaluate(() => {
  const s = window.__cvStore.getState();
  const pg = s.doc.pages.find((p) => p.id === s.doc.activePageId) ?? s.doc.pages[0];
  const centre = new Map(pg.nodes.map((n) => [n.id, { x: n.position.x + n.width / 2, y: n.position.y + n.height / 2, r: n.width / 2 + 6 }]));
  return pg.edges.map((e) => {
    const d = document.querySelector(`.react-flow__edge[data-id="${e.id}"] .react-flow__edge-path`)?.getAttribute("d") ?? "";
    // Corners only: M and L points, and a rounded corner's own corner (Q's
    // control point). Hops (A) sit on a run and do not move it.
    const pts = [];
    for (const t of d.match(/[MLQCA][^MLQCA]*/g) ?? []) {
      const n = (t.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number);
      if (t[0] === "M" || t[0] === "L") pts.push([n[0], n[1]]);
      else if (t[0] === "Q") pts.push([n[0], n[1]]);
      else if (t[0] === "A") pts.push([n[5], n[6]]);
      else if (t[0] === "C") pts.push([n[4], n[5]]);
    }
    const square = pts.slice(1).every((p, i) => Math.abs(p[0] - pts[i][0]) < 0.6 || Math.abs(p[1] - pts[i][1]) < 0.6);
    const a = pts[0], b = pts[pts.length - 1];
    const cs = centre.get(e.source), ct = centre.get(e.target);
    return { id: e.id, source: e.source, target: e.target, start: a, end: b, square, d,
      startOff: Math.abs(Math.hypot(a[0] - cs.x, a[1] - cs.y) - cs.r), endOff: Math.abs(Math.hypot(b[0] - ct.x, b[1] - ct.y) - ct.r),
      anchors: [e.data.sourceAnchor ?? null, e.data.targetAnchor ?? null] };
  });
});

for (const type of ["bezier", "straight", "smoothstep", "step", "auto"]) {
  const page = await open(browser, fixture(type));
  const all = await links(page);
  const off = all.filter((l) => l.startOff > 1 || l.endOff > 1);
  check(`${type}: every link end is on its device's ring`, off.length === 0, JSON.stringify(off.map((l) => [l.id, l.startOff.toFixed(1), l.endOff.toFixed(1)])));
  const seen = new Map();
  const shared = [];
  for (const l of all) for (const [node, p] of [[l.source, l.start], [l.target, l.end]]) {
    const key = `${node}:${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    if (seen.has(key)) shared.push([seen.get(key), l.id]);
    seen.set(key, l.id);
  }
  check(`${type}: no two links share an end on a device`, shared.length === 0, JSON.stringify(shared));
  if (type !== "bezier" && type !== "straight") {
    const slanted = all.filter((l) => !l.square);
    check(`${type}: no link has a slanted run`, slanted.length === 0, JSON.stringify(slanted.map((l) => [l.id, l.d])));
  }
  await page.close();
}

// ------------------------------------------------------------- moving an end
{
  const page = await open(browser, fixture("smoothstep"));
  const view = () => page.evaluate(() => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".react-flow__viewport")).transform);
    const b = document.querySelector(".react-flow__pane").getBoundingClientRect();
    return { k: m.a, x: b.x + m.e, y: b.y + m.f };
  });
  const v = await view();
  const screen = (fx, fy) => ({ x: v.x + fx * v.k, y: v.y + fy * v.k });
  const one = async (id) => (await links(page)).find((l) => l.id === id);

  /** Selects a link the way a person does: by clicking the middle of it. */
  const pick = async (id) => {
    const at = await page.evaluate((id) => {
      const path = document.querySelector(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`);
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const m = path.getScreenCTM();
      return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
    }, id);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(250);
  };

  // Select the link from Core 1 to Core 2 and take hold of its Core 1 end.
  await pick("cc");
  check("a selected link shows a handle at each end", (await page.locator(".cv-edge-endpoint").count()) === 2);
  const before = await one("cc");
  const grip = screen(before.start[0], before.start[1]);
  // Core 1 is at (80, 0): its centre is (118, 38). Round to the upper left.
  const centre = { x: 118, y: 38 };
  const mid = screen(centre.x - 60, centre.y - 20);
  const drop = screen(centre.x - 60, centre.y - 60);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 6 });
  await page.waitForTimeout(120);
  const during = await one("cc");
  check("while it is dragged, the end slides round the ring", during.startOff < 1.5 && during.start[0] < centre.x, JSON.stringify(during.start));
  check("…and the link stays square", during.square, during.d);
  await page.mouse.move(drop.x, drop.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await one("cc");
  check("let go, the end is on the ring where it was put", after.startOff < 1.5 && after.start[0] < centre.x && after.start[1] < centre.y, JSON.stringify(after.start));
  check("…on the diagonal the pointer was eased onto", Math.abs((centre.x - after.start[0]) - (centre.y - after.start[1])) < 1.5, JSON.stringify(after.start));
  check("…and that is what the document saved", after.anchors[0] !== null, JSON.stringify(after.anchors));
  check("…with the link still square", after.square, after.d);
  check("the other end, which nobody touched, still faces its device", after.endOff < 1.5, JSON.stringify(after.end));
  if (out) await page.locator(".react-flow").screenshot({ path: `${out}/end-moved.png` });

  // Undo puts it back.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  const undone = await one("cc");
  check("undo puts the end back", undone.anchors[0] === null && Math.abs(undone.start[0] - before.start[0]) < 1, JSON.stringify(undone.start));

  // Take the FI2 end of the Core 1 – FI2 link (u2) over to the blade chassis.
  await pick("u2");
  const u2 = await one("u2");
  const from = screen(u2.end[0], u2.end[1]);
  // The blade chassis is at (300, 420): centre (338, 458).
  const onto = screen(338 + 10, 458 - 30);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(onto.x, onto.y, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const moved = await one("u2");
  check("an end dragged onto another device moves to it", moved.target === "bc", moved.target);
  check("…and lands on that device's ring", moved.endOff < 1.5, JSON.stringify(moved.end));
  check("…with the link still square", moved.square, moved.d);
  await page.close();
}

// ------------------------------------------------------------- a new link, dropped on a device
{
  const page = await open(browser, fixture("smoothstep"));
  const countBefore = await page.evaluate(() => window.__cvStore.getState().doc.pages[0].edges.length);
  const s1 = await page.locator('.react-flow__node[data-id="s1"]').boundingBox();
  const s2 = await page.locator('.react-flow__node[data-id="s2"]').boundingBox();
  await page.mouse.move(s1.x + s1.width / 2, s1.y + s1.height / 2);
  await page.waitForTimeout(250);
  const dot = await page.locator('.react-flow__node[data-id="s1"] .react-flow__handle-right').boundingBox();
  const ringX = s1.x + s1.width + 6 * (s1.width / 76);
  check("a device's connection dots sit on its ring", Math.abs(dot.x + dot.width / 2 - ringX) < 2, `${(dot.x + dot.width / 2).toFixed(1)} vs ${ringX.toFixed(1)}`);
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  // Let go on the middle of the other device, which is where anyone aims.
  await page.mouse.move(s2.x + s2.width / 2, s2.y + s2.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const countAfter = await page.evaluate(() => window.__cvStore.getState().doc.pages[0].edges.length);
  check("a new link let go on the middle of a device connects to it", countAfter === countBefore + 1, `${countBefore} -> ${countAfter}`);
  const all = await links(page);
  const fresh = all[all.length - 1];
  check("…and meets both devices on their rings", fresh.startOff < 1.5 && fresh.endOff < 1.5, JSON.stringify([fresh.start, fresh.end]));
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
