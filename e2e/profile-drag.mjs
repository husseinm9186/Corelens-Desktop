// Where the main thread goes while one device is dragged on the campus
// fixture: frame pacing, and the functions it spent longest in.
import { chromium } from "playwright";
import { campus } from "./bench-real.mjs";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const p = campus(process.env.PATH_TYPE ?? "bezier");
await page.addInitScript((p) => { localStorage.setItem("corelens.projects.v1", JSON.stringify({ [p.meta.id]: p })); }, p);
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 400)));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 300)); });
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CPU ?? 4) });
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForSelector(".react-flow__edge", { timeout: 60000, state: "attached" });
await page.waitForTimeout(1500);
const pane = await page.locator(".react-flow__pane").boundingBox();
const cx = pane.x + pane.width / 2;
const cy = pane.y + pane.height / 2;
await page.mouse.move(cx, cy);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
await page.waitForTimeout(800);
if (process.env.LIVE === "1") {
  await page.evaluate(() => {
    const s = window.__cvStore;
    const runtime = new Map();
    for (const p of s.getState().doc.probes) runtime.set(p.id, { probeId: p.id, status: "healthy", lastRttMs: 2, lastSuccessMs: Date.now(), lastFailureMs: null, lastSummary: "reply", consecutiveFailures: 0, failureThreshold: 3 });
    s.setState({ session: { id: "bench", state: "running", startedAt: Date.now() }, runtime });
  });
  await page.waitForTimeout(1500);
}
const target = await page.evaluate(({ cx, cy }) => {
  let best = null;
  for (const el of document.querySelectorAll(".react-flow__node")) {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy);
    if (!best || d < best.d) best = { d, x: r.x + r.width / 2, y: r.y + r.height / 2, id: el.getAttribute("data-id") };
  }
  return best;
}, { cx, cy });
console.log("dragging", target.id, await page.evaluate(({x,y}) => { const e = document.elementFromPoint(x,y); return `${e?.tagName}.${e?.className?.baseVal ?? e?.className}`; }, target));
const posOf = () => page.evaluate((id) => { const d = window.__cvStore.getState().doc; const pg = d.pages.find((x) => x.id === d.activePageId) ?? d.pages[0]; return pg.nodes.find((n) => n.id === id).position; }, target.id);
const before = await posOf();
await page.evaluate(() => { window.__recF = []; window.__recOn = true; const t = (x) => { if (!window.__recOn) return; window.__recF.push(x); requestAnimationFrame(t); }; requestAnimationFrame(t); });
await cdp.send("Profiler.enable");
await cdp.send("Profiler.start");
const started = Date.now();
await page.mouse.move(target.x, target.y);
await page.mouse.down();
for (let i = 1; i <= 50; i++) await page.mouse.move(target.x + i * 4, target.y + i * 2);
await page.mouse.up();
await page.waitForTimeout(300);
const wall = Date.now() - started;
console.log("moved", JSON.stringify(before), "->", JSON.stringify(await posOf()));
const { profile } = await cdp.send("Profiler.stop");
const f = await page.evaluate(() => { window.__recOn = false; return window.__recF; });
const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
console.log(`50 steps in ${wall} ms; frames mean ${(d.reduce((s, x) => s + x, 0) / d.length).toFixed(1)} p95 ${d[Math.floor(d.length * 0.95)].toFixed(1)} max ${d[d.length - 1].toFixed(1)}`);
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const key = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop().split("?")[0]}:${n.callFrame.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
});
const total = [...self.values()].reduce((s, x) => s + x, 0);
// Inclusive time by function name, counting a name once per stack.
{
  const selfById = new Map();
  profile.samples.forEach((id, i) => selfById.set(id, (selfById.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const incl = new Map();
  const walk = (id, seen) => {
    const n = byId.get(id);
    let sum = selfById.get(id) ?? 0;
    const name = n.callFrame.functionName;
    const fresh = name && !seen.has(name);
    if (fresh) seen.add(name);
    for (const c of n.children ?? []) sum += walk(c, seen);
    if (fresh) { seen.delete(name); incl.set(name, (incl.get(name) ?? 0) + sum); }
    return sum;
  };
  walk(profile.nodes[0].id, new Set());
  const want = /^(Canvas|LiveEdgeInner|DeviceNodeInner|NoteNode|layoutLinks|HealthMiniMap|MiniMap\w*|StatusPanel|TopBar|Inspector\w*|NodeRenderer\w*|EdgeRenderer\w*|EdgeWrapper|NodeWrapper|ReactFlow\w*|GraphView\w*|Page|InkStrokes|ClusterChips|Rulers|PageTabs|NavRail|Palette|GuidePanel|ColourLegend|LinkDots|draw|commitRoot\w*|performSyncWorkOnRoot|flushSync\w*|adoptUserNodes|updateNodeInternals|onNodesChange|route|portAnchors|jumpPointsOf|jumpsFor|pushChips|chipPush|litNodes|collapseView|branchFolder|setLinkLayout|notifyLinkLayout|StoreUpdater|useSyncExternalStore\w*|memoizedSelector|updateNodePositions|commitMutationEffects\w*|commitLayoutEffects\w*|flushPassiveEffects\w*|renderRootSync|recalculateStyle|.*MiniMap.*)$/;
  console.log("inclusive:");
  const react = /^(render|perform|flush|commit|begin|mount|reconcile|invoke|call|dispatch|batched|process|work|schedule|recursively|execute|bubble|complete|create|diff|validate|warn|check|should|prepare|finalize|append|insert|mark|ReactElement|jsx|safely|attempt|bail|clone|push|pop|accumulate|extract|traverse|coerce|throw|resolve|enqueue|entangle|ensure|request|find|unstable|restore|detach|track|construct|describe|print|error|console|capture|logCaptured|basic|force|did|will|pick|include|scheduler|handle|update[A-Z]|set[A-Z]|get[A-Z]|use[A-Z]|is[A-Z]|has[A-Z])/;
  for (const [k, v] of [...incl.entries()].filter(([k]) => (process.env.ALL ? !react.test(k) : want.test(k))).sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
  console.log("self:");
}
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 26)) console.log(`${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
await browser.close();
