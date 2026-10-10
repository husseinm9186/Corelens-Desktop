// The address register as a workbench: the subnet tree on the left, the
// chosen subnet's addresses on the right, Allocate and Split & merge on its
// toolbar with that subnet already picked. And one filter grammar for the
// register, the dock's lists and the command palette. Stubbed backend.
// Invented names and documentation ranges only.
//
//     npm run dev            # in another terminal
//     node e2e/workbench.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const device = (id, label, type, x, address, tags = []) => ({
  id, type: "device", position: { x, y: 0 }, width: 76, height: 76,
  data: { label, deviceType: type, tags, locked: false, maintenance: false, showDetails: true,
    addresses: [{ id: `${id}-a`, label: "Management", address, isPrimary: true }] },
});

const project = {
  meta: { id: "wb", name: "Bench", customer: "", site: "", ticket: "", engineer: "", description: "", createdAt: NOW, updatedAt: NOW, archived: false },
  documentVersion: 1,
  document: {
    nodes: [
      device("n1", "CORE-SW1", "core-switch", 0, "192.0.2.10", ["lab"]),
      device("n2", "EDGE-RTR1", "router", 200, "192.0.2.1"),
      device("n3", "ACCESS-SW7", "access-switch", 400, "198.51.100.7"),
    ],
    edges: [],
    probes: ["n1", "n2", "n3"].map((n, i) => ({ id: `p${i}`, objectId: n, kind: "icmp", target: `192.0.2.${i + 20}`, enabled: true, intervalMs: 5000, timeoutMs: 1000, failureThreshold: 3 })),
    canvas: {},
    ipam: {
      containers: [{ id: "c1", name: "Campus", cidr: "198.51.100.0/22" }],
      subnets: [
        { id: "s1", cidr: "192.0.2.0/24", name: "Office", vlan: 30 },
        { id: "s2", cidr: "198.51.100.0/24", name: "Voice", vlan: 31, containerId: "c1" },
      ],
      entries: [{ id: "e1", address: "198.51.100.40", label: "Badge reader", kind: "in-use", assignment: "static" }],
    },
  },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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
await page.waitForTimeout(800);

// --- the tree and the table ------------------------------------------------
{
  await page.locator(".cv-nav-item", { hasText: /^Addresses$/ }).click();
  await page.waitForTimeout(500);
  const tree = page.locator('[data-region="subnet-tree"]');
  const rows = await tree.locator(".cv-subnet-row:not(.is-all) .cv-subnet-cidr").allInnerTexts();
  check("the tree holds the container, its subnet, and the subnet in none", JSON.stringify(rows) === JSON.stringify(["198.51.100.0/22", "198.51.100.0/24", "192.0.2.0/24"]), JSON.stringify(rows));
  const fill = await tree.locator('[data-key="global|192.0.2.0/24"] .cv-subnet-pct').innerText().catch(() => "missing");
  check("each row says how full it is", /^\d+%$/.test(fill), fill);
  const tableRows = () => page.locator(".cv-ipam-table tbody tr.cv-ipam-subnet, .cv-ipam-table > tbody > tr:has(.cv-cidr)").count();
  const all = await tableRows();
  check("with nothing chosen the table lists every subnet", all >= 2, String(all));

  await tree.locator('[data-key="global|198.51.100.0/24"]').click();
  await page.waitForTimeout(300);
  check("choosing a subnet narrows the table to it", (await tableRows()) === 1, String(await tableRows()));
  check("and opens it on its addresses", (await page.locator(".cv-ipam-table", { hasText: "Badge reader" }).count()) === 1);
  check("and names it on the toolbar", /198\.51\.100\.0\/24 · Voice/.test(await page.locator('[data-region="subnet-tools"]').innerText()));

  await tree.locator('.cv-subnet-row.is-container').click();
  await page.waitForTimeout(200);
  check("a container's row closes it", (await tree.locator('[data-key="global|198.51.100.0/24"]').count()) === 0);
  await tree.locator('.cv-subnet-row.is-container').click();
  await page.waitForTimeout(200);

  // The tools act on the chosen subnet.
  await page.locator('[data-region="subnet-tools"] button', { hasText: "Allocate" }).click();
  await page.waitForTimeout(400);
  const picked = await page.locator(".cv-lab-wizard select").first().inputValue();
  check("Allocate opens with the chosen subnet already picked", picked === "global|198.51.100.0/24", picked);
  await page.locator(".cv-register-tabs button", { hasText: "Addresses" }).click();
  await page.waitForTimeout(300);
  check("and Addresses is the way back to the table", (await page.locator(".cv-ipam-table").count()) === 1);
  await page.locator('[data-region="register-setup"]').click();
  await page.waitForTimeout(300);
  check("the cog opens the sites, tenants and fields", (await page.locator('[data-region="register-setup"][aria-pressed="true"]').count()) === 1 && (await page.locator('[data-region="subnet-tree"]').count()) === 0);
  await page.locator(".cv-register .cv-crumb-home").click();
  await page.waitForTimeout(400);
}

// --- one grammar: the dock ----------------------------------------------------
{
  await page.locator(".cv-panel [role=tab]", { hasText: "Monitored objects" }).click();
  await page.waitForTimeout(300);
  const filter = page.locator(".cv-panel .cv-input").first();
  const names = () => page.locator(".cv-panel tbody tr[data-id] .cv-name").allInnerTexts();
  await filter.fill("type:router");
  await page.waitForTimeout(300);
  check("the dock narrows by a field", JSON.stringify(await names()) === JSON.stringify(["EDGE-RTR1"]), JSON.stringify(await names()));
  await filter.fill("sw -tag:lab");
  await page.waitForTimeout(300);
  check("and excludes with a minus", JSON.stringify(await names()) === JSON.stringify(["ACCESS-SW7"]), JSON.stringify(await names()));
  const lit = await page.evaluate(() => [...(window.__cvStore.getState().canvasHighlight ?? [])]);
  check("lighting the same devices on the canvas", JSON.stringify(lit) === JSON.stringify(["n3"]), JSON.stringify(lit));
  await filter.fill("");
}

// --- one grammar: the palette -------------------------------------------------
{
  await page.locator(".react-flow__pane").click({ position: { x: 600, y: 300 } });
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  check("the palette opens", (await page.locator(".cv-command-palette").count()) === 1);
  await page.locator(".cv-command-input").fill("sw type:core-switch");
  await page.waitForTimeout(300);
  const hits = await page.locator(".cv-command-results [role=option] .cv-command-title").allInnerTexts();
  check("the palette narrows its search the same way", hits.length > 0 && hits.every((h) => /CORE-SW1/.test(h)), JSON.stringify(hits));
  await page.keyboard.press("Escape");
}

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
