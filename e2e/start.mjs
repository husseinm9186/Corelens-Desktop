// The start screen in its two states: before the first project, three ways
// in — map a network from a seed, a blank project, an import — and the
// samples drawn from their own devices; afterwards the projects, with the
// samples stepped back to a row of names. "Map a network" makes a project
// named after the seed's subnet and opens Discover with the seed filled in.
// Stubbed backend. Invented names only.
//
//     npm run dev            # in another terminal
//     node e2e/start.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.addInitScript(() => {
  const saved = new Map();
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback() { return next++; },
    invoke(cmd, args) {
      if (cmd === "plugin:event|listen") return Promise.resolve(next++);
      if (cmd === "list_projects") return Promise.resolve([...saved.values()].map((p) => p.meta));
      if (cmd === "save_project") { saved.set(args.package.meta.id, args.package); return Promise.resolve(null); }
      if (cmd === "load_project") return Promise.resolve(saved.get(args.id) ?? null);
      if (cmd === "get_settings") return Promise.resolve({});
      if (cmd === "vault_status") return Promise.resolve({ exists: false, unlocked: false, credentials: 0, minimumPassphrase: 12 });
      return Promise.resolve([]);
    },
  };
});
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(500);

// --- before the first project ---------------------------------------------
{
  const cards = page.locator('[data-region="start-cards"] > *');
  check("three ways in", (await cards.count()) === 3, String(await cards.count()));
  const titles = await page.locator('[data-region="start-cards"] .cv-start-title').allInnerTexts();
  check("map a network, a blank project, an import", JSON.stringify(titles) === JSON.stringify(["Map a network", "Create a blank project", "Import a project"]), titles.join(" | "));
  check("no empty project list beside them", (await page.locator('[data-region="projects"]').count()) === 0);
  const thumbs = page.locator('.cv-start-samples .cv-sample [data-region="sample-thumb"]');
  check("each sample has a picture", (await thumbs.count()) === 4, String(await thumbs.count()));
  const dots = await thumbs.evaluateAll((els) => els.map((e) => e.querySelectorAll("circle").length));
  check("drawn from its own devices", dots.every((n) => n > 3) && new Set(dots).size > 1, JSON.stringify(dots));

  const seed = page.getByLabel("Address or name to start from");
  const go = page.locator('[data-region="start-map"] button[type="submit"]');
  check("Start discovery waits for a seed", await go.isDisabled());
  await seed.fill("not an address");
  check("and for a real one", await go.isDisabled());
  await seed.fill("192.0.2.1");
  check("an address will do", await go.isEnabled());
  await go.click();
  await page.waitForTimeout(1200);
  const name = await page.evaluate(() => window.__cvStore.getState().meta?.name ?? "");
  check("a project is made, named after the seed's subnet and the date", /^192\.0\.2\.0\/24 — \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(name), name);
  check("and opens on Discover", (await page.locator(".cv-nav-item.is-current").innerText()) === "Discover");
  const typed = await page.locator(".cv-field", { hasText: "Seed devices" }).locator("input").inputValue();
  check("with the seed already filled in", typed === "192.0.2.1", typed);
}

// --- afterwards -------------------------------------------------------------
{
  await page.evaluate(() => window.__cvStore.getState().closeProject());
  await page.waitForTimeout(800);
  check("with a project, the three cards give way to the list", (await page.locator('[data-region="start-cards"]').count()) === 0 && (await page.locator('[data-region="projects"] .cv-project-card').count()) === 1);
  const chips = page.locator(".cv-proj-samples .cv-sample.is-chip");
  check("and the samples step back to a row of names", (await chips.count()) === 4 && (await page.locator(".cv-proj-samples .cv-sample-desc").count()) === 0);
  await chips.filter({ hasText: "Campus wireless" }).click();
  await page.waitForTimeout(1000);
  check("a name still opens its sample", /Campus wireless/.test(await page.evaluate(() => window.__cvStore.getState().meta?.name ?? "")));
}

// A package written before a project had pages keeps its devices and links
// at the top of the document. It still imports, and draws.
{
  const fresh = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  fresh.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await fresh.goto(URL, { waitUntil: "networkidle" });
  const device = (id, label, x) => ({ id, type: "device", position: { x, y: 0 }, width: 176, height: 96,
    data: { label, deviceType: "router", tags: [], addresses: [], locked: false, maintenance: false, showDetails: true } });
  const old = {
    meta: { id: "old", name: "Before pages", customer: "", site: "", ticket: "", engineer: "", description: "", createdAt: 1, updatedAt: 1, archived: false },
    documentVersion: 1,
    document: { nodes: [device("r1", "EDGE-1", 0), device("r2", "EDGE-2", 400)], edges: [], probes: [], canvas: {} },
  };
  await fresh.locator('input[type=file][accept*=".corelens"]').first().setInputFiles({ name: "before-pages.coreview", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(old)) });
  await fresh.waitForTimeout(1500);
  const drawn = await fresh.locator(".react-flow__node").count();
  check("a package in the single-page shape imports and draws its devices", drawn === 2 && errors.length === 0, JSON.stringify({ drawn, errors: errors.slice(0, 2) }));
  await fresh.close();
}

// The application's settings are on the start screen; a project's are not.
{
  const fresh = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  fresh.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await fresh.goto(URL, { waitUntil: "networkidle" });
  const button = fresh.locator('[data-action="app-settings"]');
  check("the start screen has a Settings button", (await button.count()) === 1 && /Settings/.test(await button.innerText()));
  await button.click();
  await fresh.waitForTimeout(400);
  const nav = await fresh.locator(".cv-settings-nav-item").allInnerTexts();
  check("it opens the application's settings, and only those", JSON.stringify(nav) === JSON.stringify(["Display", "Terminal", "Updates", "Shared projects", "Saved credentials"]), JSON.stringify(nav));
  check("in place of the projects", (await fresh.locator('[data-region="projects"]').count()) === 0 && (await fresh.locator('[data-region="settings-application"]').count()) === 1);
  check("saying where a project's own are", /inside that project/.test(await fresh.locator('[data-hint="settings-where"]').innerText()));
  await fresh.locator(".cv-settings-nav-item", { hasText: "Saved credentials" }).click();
  await fresh.waitForTimeout(500);
  const now = await fresh.locator(".cv-settings-nav-item.is-current").innerText();
  check("its nav moves to a section", now === "Saved credentials", now);
  check("the button now leads back", /Back to projects/.test(await button.innerText()));
  {
    const clipped = await fresh.locator('[data-region="settings-application"]').evaluate((root) => [...(root ?? document).querySelectorAll("select")].flatMap((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width) return [];
    const cs = getComputedStyle(el);
    const c = document.createElement("canvas").getContext("2d");
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = el.selectedOptions[0]?.text ?? "";
    const need = c.measureText(text).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    return need > r.width + 1 ? [`"${text}" needs ${Math.round(need)} has ${Math.round(r.width)}`] : [];
  }));
    check("no dropdown in the application's settings is narrower than what it says", clipped.length === 0, clipped.join(" | "));
  }
  await button.click();
  await fresh.waitForTimeout(300);
  check("and back to the projects", (await fresh.locator('[data-region="settings-application"]').count()) === 0);
  check("with no error on the way", errors.length === 0, JSON.stringify(errors.slice(0, 2)));
  await fresh.close();
}

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
