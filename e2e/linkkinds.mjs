// What a link is, drawn into its stroke: a bundle doubled, a tunnel dashed,
// a logical hop dotted, a transit circuit heavier. Port chips round a crowded
// device wait to be asked for and the device says how many links it has;
// chips that would land on each other are pushed apart; a traced path points
// its links the way it goes. Stubbed backend. Invented names only.
//
//     npm run dev            # in another terminal
//     node e2e/linkkinds.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const dev = (id, label, x, y, deviceType = "access-switch") => ({
  id, type: "device", position: { x, y }, width: 76, height: 76,
  data: { label, deviceType, tags: [], addresses: [], locked: false, maintenance: false, showDetails: false },
});
const link = (id, source, target, over = {}) => ({
  id, source, target, sourceHandle: "b", targetHandle: "t", type: "live",
  data: {
    sourcePortLabel: "", targetPortLabel: "", label: "", pathType: "straight", direction: "none",
    width: 2, color: "#7c8fa3", enabled: true, maintenance: false, lineStyle: "solid",
    healthRule: { type: "manual", manualStatus: "unknown" }, ...over,
  },
});

const project = {
  meta: { id: "lk", name: "Link kinds", customer: "", site: "", ticket: "", engineer: "", description: "", createdAt: NOW, updatedAt: NOW, archived: false },
  documentVersion: 1,
  document: {
    nodes: [
      // Pairs, one per kind.
      dev("c1", "CAB-A", 0, 0), dev("c2", "CAB-B", 300, 0),
      dev("b1", "BUN-A", 0, 200), dev("b2", "BUN-B", 300, 200),
      dev("t1", "TUN-A", 0, 400, "router"), dev("t2", "TUN-B", 300, 400, "router"),
      dev("l1", "L3-A", 0, 600, "router"), dev("l2", "L3-B", 300, 600, "router"),
      dev("w1", "WAN-A", 0, 800, "router"), dev("w2", "WAN-B", 300, 800, "router"),
      // A hub with five links: crowded.
      dev("hub", "HUB-1", 900, 0, "core-switch"),
      dev("h1", "LEAF-1", 700, 400), dev("h2", "LEAF-2", 800, 400), dev("h3", "LEAF-3", 900, 400),
      dev("h4", "LEAF-4", 1000, 400), dev("h5", "LEAF-5", 1100, 400),
      // Two devices side by side, each with a link straight down: each chip
      // sits beside its own line, and the right-hand one's reaches the left.
      dev("p1", "PUSH-1", 1400, 0), dev("p2", "PUSH-2", 1480, 0),
      dev("q1", "PUSH-3", 1400, 300), dev("q2", "PUSH-4", 1480, 300),
      // A path of three for the arrows.
      dev("r1", "PATH-1", 0, 1000, "router"), dev("r2", "PATH-2", 300, 1000, "router"), dev("r3", "PATH-3", 600, 1000, "router"),
    ],
    edges: [
      link("ec", "c1", "c2"),
      link("eb", "b1", "b2", { notes: "Discovered: Po1 ↔ Po1 — 2 bundled ports: Gi1/0/1, Gi1/0/2" }),
      link("et", "t1", "t2", { overlay: true }),
      link("el", "l1", "l2", { layer3: true }),
      link("ew", "w1", "w2", { cableType: "wan" }),
      ...[1, 2, 3, 4, 5].map((i) => link(`eh${i}`, "hub", `h${i}`, { sourcePortLabel: `Te1/1/${i}`, targetPortLabel: `Gi0/${i}` })),
      link("ep1", "p1", "q1", { sourcePortLabel: "GigabitEthernet1/0/11" }),
      link("ep2", "p2", "q2", { sourcePortLabel: "GigabitEthernet1/0/12" }),
      link("er1", "r1", "r2"), link("er2", "r2", "r3"),
    ],
    probes: [], canvas: {},
  },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.addInitScript(({ p }) => {
  localStorage.setItem("coreview.projects.v1", JSON.stringify({ [p.meta.id]: p }));
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

const path = (id) => page.locator(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`).first();
const styleOf = (id) => path(id).evaluate((el) => ({
  dash: el.style.strokeDasharray, width: parseFloat(el.style.strokeWidth), mask: el.getAttribute("mask"), end: el.getAttribute("marker-end"), start: el.getAttribute("marker-start"),
}));
const st = (fn, arg) => page.evaluate(fn, arg);

// --- each kind in the stroke --------------------------------------------
{
  const c = await styleOf("ec");
  const b = await styleOf("eb");
  const t = await styleOf("et");
  const l = await styleOf("el");
  const w = await styleOf("ew");
  check("a cable is a plain solid line", !c.dash && !c.mask, JSON.stringify(c));
  check("a bundle is doubled: drawn wide with its middle masked out", b.mask === 'url("#cv-double-eb")' || b.mask === "url(#cv-double-eb)", JSON.stringify(b));
  check("and its mask exists", (await page.locator("mask#cv-double-eb").count()) === 1);
  check("a tunnel is dashed", t.dash.replace(/px/g, "") === "6, 4", JSON.stringify(t));
  check("a logical hop is dotted", l.dash.replace(/px/g, "") === "1.5, 3", JSON.stringify(l));
  check("a transit circuit is heavier than a cable", w.width > c.width, `${w.width} vs ${c.width}`);
}

// --- the inspector names the kind and can change it --------------------
{
  await st(() => window.__cvStore.getState().select(null, "ec"));
  await page.waitForTimeout(400);
  const kind = page.getByLabel("Kind", { exact: true });
  check("the link inspector offers a kind", (await kind.count()) === 1);
  check("which says what Auto worked out", (await kind.locator("option").first().textContent()) === "Auto — Cable");
  await kind.selectOption("bundle");
  await page.waitForTimeout(400);
  const now = await styleOf("ec");
  check("choosing Bundle doubles the line", !!now.mask, JSON.stringify(now));
  await kind.selectOption("auto");
  await page.waitForTimeout(300);
  check("and Auto puts it back", !(await styleOf("ec")).mask);
  await st(() => window.__cvStore.getState().select(null, null));
  await page.waitForTimeout(300);
}

// --- a crowded device ---------------------------------------------------
const chip = (text) => page.locator(".cv-edge-port", { hasText: text }).first();
const shown = async (text) => (await chip(text).evaluate((el) => getComputedStyle(el).visibility)) === "visible";
{
  // Fitted, the canvas is well under 120 %.
  await page.keyboard.press("f");
  await page.waitForTimeout(500);
  check("a device with five links says so under its name", (await page.locator('[data-id="hub"] [data-region="node-links"]').textContent()) === "5 links");
  check("a device with one link says nothing", (await page.locator('[data-id="h1"] [data-region="node-links"]').count()) === 0);
  check("its port chips wait to be asked for", !(await shown("Te1/1/3")));
  check("the far end's chip, at a device with one link, still shows", await shown("Gi0/3"));
  await st(() => window.__cvStore.getState().select(null, "eh3"));
  await page.waitForTimeout(400);
  check("selecting the link shows its chip", await shown("Te1/1/3"));
  check("but not the others'", !(await shown("Te1/1/2")));
  await st(() => window.__cvStore.getState().select("hub", null));
  await page.waitForTimeout(400);
  check("selecting the device shows all of its chips", (await shown("Te1/1/1")) && (await shown("Te1/1/5")));
  await st(() => window.__cvStore.getState().select(null, null));
  await page.waitForTimeout(400);
  // Close up there is room for every chip, and the count goes.
  const hub = await page.locator('[data-id="hub"]').boundingBox();
  await page.mouse.move(hub.x + hub.width / 2, hub.y + hub.height / 2);
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Control+=");
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  check("zoomed in past 120 % the canvas says so", (await page.locator(".cv-canvas.is-close").count()) === 1);
  check("and every chip shows", await shown("Te1/1/4"));
  check("and the count is gone", !(await page.locator('[data-id="hub"] [data-region="node-links"]').isVisible()));
  await page.keyboard.press("f");
  await page.waitForTimeout(500);
}

// --- chips pushed apart ---------------------------------------------------
{
  await page.waitForTimeout(300);
  const a = await chip("GigabitEthernet1/0/11").boundingBox();
  const b = await chip("GigabitEthernet1/0/12").boundingBox();
  const overlap = a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  check("the chips of neighbouring devices do not land on each other", a && b && !overlap, JSON.stringify({ a, b }));
}

// --- arrows only on a traced path ---------------------------------------
{
  check("an undirected link carries no arrow", !(await styleOf("er1")).end && !(await styleOf("er1")).start);
  await st(() => window.__cvStore.getState().setCanvasPath(["r3", "r2", "r1"]));
  await page.waitForTimeout(400);
  const one = await styleOf("er1");
  const two = await styleOf("er2");
  // The path runs r3 → r2 → r1, against both links' drawn direction.
  check("on a traced path a link points the way the path goes", !!one.start && !one.end && !!two.start && !two.end, JSON.stringify({ one, two }));
  check("a link off the path is left alone", !(await styleOf("ec")).end && !(await styleOf("ec")).start);
  await st(() => window.__cvStore.getState().setCanvasPath(null));
  await page.waitForTimeout(400);
  check("and the arrows go with the path", !(await styleOf("er1")).start);
}

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
