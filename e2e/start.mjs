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

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
