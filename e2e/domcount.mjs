// What the campus fixture's DOM is made of: elements per device, per link,
// and the commonest classes — the canvas's cost to hit-test and paint
// follows this count.
import { chromium } from "playwright";
import { campus } from "./bench-real.mjs";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const p = campus(process.env.PATH_TYPE ?? "bezier");
await page.addInitScript((p) => { localStorage.setItem("corelens.projects.v1", JSON.stringify({ [p.meta.id]: p })); }, p);
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForSelector(".react-flow__edge", { timeout: 60000, state: "attached" });
await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(() => {
  const count = (sel) => document.querySelectorAll(sel).length;
  const inside = (sel) => [...document.querySelectorAll(sel)].reduce((s, el) => s + el.querySelectorAll("*").length + 1, 0);
  const classes = new Map();
  for (const el of document.querySelectorAll(".react-flow__viewport *")) {
    const k = `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/)[0]}`;
    classes.set(k, (classes.get(k) ?? 0) + 1);
  }
  return {
    all: count("*"), viewport: count(".react-flow__viewport *"),
    nodes: count(".react-flow__node"), inNodes: inside(".react-flow__node"),
    edges: count(".react-flow__edge"), inEdges: inside(".react-flow__edge"),
    labels: inside(".react-flow__edgelabel-renderer"), portal: inside(".react-flow__viewport-portal"),
    minimap: inside(".react-flow__minimap"), chrome: count("*") - count(".react-flow *"),
    top: [...classes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28),
  };
}), null, 1));
await browser.close();
