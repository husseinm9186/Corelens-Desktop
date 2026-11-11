// Canvas benchmark on a diagram shaped like a real one.
//
// bench-canvas.mjs measures scale: thousands of bare devices on a grid. This
// measures what a working diagram costs at an ordinary size — a tiered campus
// of ~150 devices and ~230 links, every link with a port label at both ends,
// every device with a probe — because that is the diagram people actually
// drag things around on, and it exercises what the grid does not: port chips,
// line hops, routed links, travelling dots, and monitoring results arriving
// while the pointer is busy.
//
//     npm run dev
//     PATHS=bezier,auto CPU=4 OUT=real.json node e2e/bench-real.mjs
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const PATHS = (process.env.PATHS ?? "bezier,smoothstep,auto").split(",");
const CPU = Number(process.env.CPU ?? 4);
const STEPS = Number(process.env.STEPS ?? 50);
const NOW = 1756000000000;

export function campus(pathType) {
  const nodes = [];
  const edges = [];
  const probes = [];
  const dev = (id, label, deviceType, x, y) => {
    nodes.push({ id, type: "device", position: { x, y }, width: 76, height: 76,
      data: { label, deviceType, tags: [], addresses: [{ id: `a-${id}`, label: "Management", address: `10.0.${nodes.length >> 8}.${nodes.length & 255}`, isPrimary: true }],
        locked: false, maintenance: false, showDetails: true } });
    probes.push({ id: `p-${id}`, projectId: "real", objectKind: "node", objectId: id, name: "ICMP", kind: "icmp",
      target: `10.0.0.${probes.length + 1}`, intervalSeconds: 5, timeoutMs: 1000, failureThreshold: 3, recoveryThreshold: 2,
      enabled: true, maintenance: false, isPrimary: true });
  };
  let n = 0;
  const link = (source, target, sp, tp) => {
    edges.push({ id: `l${n++}`, source, target, sourceHandle: "b", targetHandle: "t", type: "live",
      data: { sourcePortLabel: sp, targetPortLabel: tp, label: "", pathType, direction: "none", width: 2,
        enabled: true, maintenance: false, healthRule: { type: "both-endpoints" } } });
  };
  const W = 48 * 150;
  dev("core1", "CORE-1", "core-switch", W / 2 - 300, 0);
  dev("core2", "CORE-2", "core-switch", W / 2 + 300, 0);
  link("core1", "core2", "Po1", "Po1");
  link("core1", "core2", "Po2", "Po2");
  for (let d = 0; d < 8; d++) {
    const id = `dist${d}`;
    dev(id, `DIST-${d + 1}`, "distribution-switch", (d + 0.5) * (W / 8), 320);
    link("core1", id, `Te1/0/${d + 1}`, "Te1/1/1");
    link("core2", id, `Te1/0/${d + 1}`, "Te1/1/2");
  }
  for (let a = 0; a < 48; a++) {
    const id = `acc${a}`;
    dev(id, `ACC-${String(a + 1).padStart(2, "0")}`, "access-switch", a * 150, 660);
    const d = Math.floor(a / 6);
    link(`dist${d}`, id, `Gi1/0/${(a % 6) + 1}`, "Gi1/0/49");
    link(`dist${d % 2 === 0 ? d + 1 : d - 1}`, id, `Gi1/0/${(a % 6) + 7}`, "Gi1/0/50");
  }
  for (let s = 0; s < 96; s++) {
    const id = `srv${s}`;
    dev(id, `SRV-${String(s + 1).padStart(3, "0")}`, "server", (s % 48) * 150 + (s >= 48 ? 40 : 0), 960 + (s >= 48 ? 260 : 0));
    link(`acc${s % 48}`, id, `Gi1/0/${Math.floor(s / 48) + 1}`, "eth0");
  }
  return {
    meta: { id: "real", name: "Campus", customer: "", site: "", ticket: "", engineer: "", description: "",
      createdAt: NOW, updatedAt: NOW, archived: false },
    documentVersion: 1,
    // HOPS=0 turns the page's line hops off, to see what they cost.
    document: { nodes, edges, probes, canvas: process.env.HOPS === "0" ? { lineJumps: false } : {} },
  };
}

const stats = (intervals) => {
  const d = [...intervals].sort((a, b) => a - b);
  if (d.length === 0) return { frames: 0, meanMs: null, p95Ms: null, maxMs: null };
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  return { frames: d.length, meanMs: +mean.toFixed(1), p95Ms: +d[Math.min(d.length - 1, Math.floor(d.length * 0.95))].toFixed(1), maxMs: +d[d.length - 1].toFixed(1) };
};

async function measure(page, run) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__framesOn = true;
    const tick = (t) => { if (!window.__framesOn) return; window.__frames.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const started = Date.now();
  await run();
  await page.waitForTimeout(250);
  const wallMs = Date.now() - started;
  const times = await page.evaluate(() => { window.__framesOn = false; return window.__frames; });
  return { wallMs, ...stats(times.slice(1).map((t, i) => t - times[i])) };
}

/** Monitoring results arriving the way the engine sends them: one sample per
 *  probe per interval, spread evenly. */
const startSamples = (page, perSecond) => page.evaluate((perSecond) => {
  const s = window.__cvStore;
  s.setState({ session: { id: "bench", state: "running", startedAt: Date.now() }, runtime: new Map() });
  const probes = s.getState().doc.probes;
  let i = 0;
  window.__samples = setInterval(() => {
    const p = probes[i++ % probes.length];
    s.getState().applyEngineEvent({ kind: "sample", sessionId: "bench", status: "healthy",
      result: { probeId: p.id, rttMs: 1 + (i % 7), summary: "reply", timestampMs: Date.now(), outcome: "success" } });
  }, 1000 / perSecond);
}, perSecond);
const stopSamples = (page) => page.evaluate(() => clearInterval(window.__samples));

async function benchOne(browser, pathType) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await context.newPage();
  const p = campus(pathType);
  await page.addInitScript((p) => { localStorage.setItem("corelens.projects.v1", JSON.stringify({ [p.meta.id]: p })); }, p);
  page.on("pageerror", (e) => console.log("  PAGE EXCEPTION:", String(e).slice(0, 200)));
  if (CPU > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  }
  await page.goto(URL, { waitUntil: "networkidle" });
  const t0 = Date.now();
  await page.locator(".cv-project-open").first().click();
  await page.waitForSelector(".react-flow__node", { timeout: 60000 });
  if (await page.locator(".cv-recovery").count()) await page.locator(".cv-recovery button", { hasText: "Keep what was saved" }).click();
  // Opened once the links have drawn and the page has been quiet for a frame.
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__edge").length > 0, null, { timeout: 60000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const openMs = Date.now() - t0;
  await page.waitForTimeout(1500);

  const pane = await page.locator(".react-flow__pane").boundingBox();
  const cx = pane.x + pane.width / 2;
  const cy = pane.y + pane.height / 2;
  // Close enough that labels are being drawn, on the busy middle of the page.
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(800);

  const target = async () => page.evaluate(({ cx, cy }) => {
    let best = null;
    for (const el of document.querySelectorAll(".react-flow__node")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const d = Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy);
      if (!best || d < best.d) best = { d, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    return best;
  }, { cx, cy });
  const dragIt = async () => {
    const t = await target();
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    for (let i = 1; i <= STEPS; i++) await page.mouse.move(t.x + i * 4, t.y + i * 2);
    await page.mouse.up();
  };
  const panIt = async () => {
    await page.mouse.move(cx + 200, cy + 200);
    await page.mouse.down({ button: "middle" });
    for (let i = 1; i <= STEPS; i++) await page.mouse.move(cx + 200 - i * 6, cy + 200 - i * 3);
    await page.mouse.up({ button: "middle" });
  };
  const zoomIt = async () => {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < STEPS / 2; i++) await page.mouse.wheel(0, -60);
    for (let i = 0; i < STEPS / 2; i++) await page.mouse.wheel(0, 60);
  };

  const out = { pathType, openMs };
  out.idle = await measure(page, () => page.waitForTimeout(1500));
  out.pan = await measure(page, panIt);
  out.zoom = await measure(page, zoomIt);
  out.drag = await measure(page, dragIt);
  // Monitoring can only be staged where the store is reachable from the page,
  // which is the dev server; against a production build those rows are left out.
  if (await page.evaluate(() => Boolean(window.__cvStore))) {
    await startSamples(page, 60);
    await page.waitForTimeout(3500); // every probe has answered: links are live
    out.liveIdle = await measure(page, () => page.waitForTimeout(1500));
    out.livePan = await measure(page, panIt);
    out.liveDrag = await measure(page, dragIt);
    await stopSamples(page);
  }
  await context.close();
  return out;
}

// Importing this file for its fixture runs nothing.
if (import.meta.url === `file://${process.argv[1]}`) {
const browser = await chromium.launch();
const results = [];
for (const pathType of PATHS) {
  process.stdout.write(`${pathType} (CPU x${CPU})…\n`);
  const r = await benchOne(browser, pathType);
  results.push(r);
  console.log(`  open     ${r.openMs} ms`);
  for (const k of ["idle", "pan", "zoom", "drag", "liveIdle", "livePan", "liveDrag"]) {
    const s = r[k];
    if (!s) continue;
    console.log(`  ${k.padEnd(8)} mean ${String(s.meanMs).padStart(6)} ms  p95 ${String(s.p95Ms).padStart(6)} ms  max ${String(s.maxMs).padStart(7)} ms  (${s.frames} frames in ${s.wallMs} ms)`);
  }
}
await browser.close();
if (process.env.OUT) writeFileSync(process.env.OUT, `${JSON.stringify({ at: new Date().toISOString(), cpu: CPU, results }, null, 2)}\n`);
}
