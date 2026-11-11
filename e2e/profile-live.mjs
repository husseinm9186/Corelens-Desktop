// Where the time goes while monitoring runs on the campus fixture: frame
// pacing with results arriving, with them stopped (the travelling dots alone),
// and the functions the main thread spent longest in.
import { chromium } from "playwright";
import { campus } from "./bench-real.mjs";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const CPU = Number(process.env.CPU ?? 4);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const p = campus(process.env.PATH_TYPE ?? "bezier");
await page.addInitScript((p) => { localStorage.setItem("corelens.projects.v1", JSON.stringify({ [p.meta.id]: p })); }, p);
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForSelector(".react-flow__edge", { timeout: 60000, state: "attached" });
await page.waitForTimeout(1500);
const pane = await page.locator(".react-flow__pane").boundingBox();
await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
await page.waitForTimeout(800);

const frames = async (ms) => {
  await page.evaluate(() => { window.__recF = []; window.__recOn = true; const t = (x) => { if (!window.__recOn) return; window.__recF.push(x); requestAnimationFrame(t); }; requestAnimationFrame(t); });
  await page.waitForTimeout(ms);
  const f = await page.evaluate(() => { window.__recOn = false; return window.__recF; });
  const d = f.slice(1).map((t, i) => t - f[i]);
  return `${(d.reduce((s, x) => s + x, 0) / d.length).toFixed(1)} ms mean over ${d.length} frames`;
};
console.log("before monitoring:   ", await frames(1500));
await page.evaluate(() => {
  const s = window.__cvStore;
  s.setState({ session: { id: "bench", state: "running", startedAt: Date.now() }, runtime: new Map() });
  const probes = s.getState().doc.probes;
  let i = 0;
  window.__samples = setInterval(() => {
    const p = probes[i++ % probes.length];
    s.getState().applyEngineEvent({ kind: "sample", sessionId: "bench", status: "healthy",
      result: { probeId: p.id, rttMs: 1 + (i % 7), summary: "reply", timestampMs: Date.now(), outcome: "success" } });
  }, 1000 / 60);
});
await page.waitForTimeout(3500);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.start");
console.log("monitoring, results arriving:", await frames(3000));
const { profile } = await cdp.send("Profiler.stop");
await page.evaluate(() => clearInterval(window.__samples));
await page.waitForTimeout(500);
console.log("monitoring, results paused: ", await frames(1500));
await page.evaluate(() => window.__cvStore.getState().setSettings({ reduceMotion: true }));
await page.waitForTimeout(500);
console.log("…and motion reduced:        ", await frames(1500));

const self = new Map();
const dt = profile.timeDeltas;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const key = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop().split("?")[0]}:${n.callFrame.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
});
const total = [...self.values()].reduce((s, x) => s + x, 0);
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
await browser.close();
