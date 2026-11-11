// Screenshots of the link geometry this app draws, for looking at.
//
// The fixture is the shape that kept going wrong: two fabric interconnects
// above a blade chassis, each wired to it twice, to each other twice, and up
// to a pair of cores — once per path type, so every router is seen on the
// same wiring.
//
//     npm run dev
//     node e2e/linkshots.mjs outdir
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "linkshots";
mkdirSync(out, { recursive: true });
const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

const dev = (id, label, deviceType, x, y) => ({
  id, type: "device", position: { x, y }, width: 76, height: 76,
  data: { label, deviceType, tags: [], addresses: [], locked: false, maintenance: false, showDetails: true },
});
const link = (id, source, target, pathType, extra = {}) => ({
  id, source, target, sourceHandle: "b", targetHandle: "t", type: "live",
  data: { sourcePortLabel: "", targetPortLabel: "", label: "", ...(pathType ? { pathType } : {}), direction: "none",
    width: 2, enabled: true, maintenance: false, healthRule: { type: "manual", manualStatus: "unknown" }, ...extra },
});

export function fixture(pathType) {
  const nodes = [
    dev("c1", "Core 1", "core-switch", 80, 0),
    dev("c2", "Core 2", "core-switch", 520, 0),
    dev("fi1", "FI1", "access-switch", 0, 240),
    dev("fi2", "FI2", "access-switch", 600, 220),
    dev("bc", "Blade chassis", "blade-chassis", 300, 420),
    dev("s1", "ESX 1", "server", 240, 640),
    dev("s2", "ESX 2", "server", 380, 640),
  ];
  const edges = [
    link("u1", "c1", "fi1", pathType), link("u2", "c1", "fi2", pathType),
    link("u3", "c2", "fi1", pathType), link("u4", "c2", "fi2", pathType),
    link("x1", "fi1", "fi2", pathType), link("x2", "fi1", "fi2", pathType),
    link("a1", "fi1", "bc", pathType, { sourcePortLabel: "Eth1/1", targetPortLabel: "IOM1/1" }),
    link("a2", "fi1", "bc", pathType, { sourcePortLabel: "Eth1/2", targetPortLabel: "IOM1/2" }),
    link("b1", "fi2", "bc", pathType, { sourcePortLabel: "Po1019" }), link("b2", "fi2", "bc", pathType),
    link("d1", "bc", "s1", pathType), link("d2", "bc", "s2", pathType),
    link("cc", "c1", "c2", pathType),
  ];
  return {
    meta: { id: `links-${pathType ?? "default"}`, name: `Links ${pathType ?? "default"}`, customer: "", site: "", ticket: "",
      engineer: "", description: "", createdAt: NOW, updatedAt: NOW, archived: false },
    documentVersion: 1,
    document: { nodes, edges, probes: [], canvas: {} },
  };
}

export async function open(browser, project, viewport = { width: 1400, height: 950 }) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript((p) => {
    localStorage.setItem("corelens.projects.v1", JSON.stringify({ [p.meta.id]: p }));
  }, project);
  page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator(".cv-project-open").first().click();
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  if (await page.locator(".cv-recovery").count()) {
    await page.locator(".cv-recovery button", { hasText: "Keep what was saved" }).click();
  }
  await page.waitForTimeout(700);
  return page;
}

export const launch = () => chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await launch();
  for (const type of (process.env.TYPES ?? "bezier,auto,smoothstep,step,straight").split(",")) {
    const page = await open(browser, fixture(type));
    const pane = page.locator(".react-flow");
    await pane.screenshot({ path: `${out}/${type ?? "default"}.png` });
    // And with FI2 selected, where the ring and the ends are both in view.
    await page.locator('.react-flow__node[data-id="fi2"] .cv-glyph-hit').click();
    await page.waitForTimeout(300);
    await pane.screenshot({ path: `${out}/${type ?? "default"}-selected.png` });
    await page.close();
  }
  await browser.close();
}
