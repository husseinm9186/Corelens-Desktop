// A name or a value can be read where there is little room for it: the
// page tabs of a project with many pages, the address and check fields of
// the inspector, the rail's labels; and a field that cannot show all of
// what it holds says the rest when pointed at.
//
//     npm run dev            # in another terminal
//     node e2e/readable.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

// Nineteen pages, named the way a set of drawings is: a number, then what
// the page is.
const TITLES = ["Index", "Physical topology", "Spine and leaf", "VXLAN overlay", "Border leaves", "Routing underlay", "Routing overlay", "Transit to the core",
  "VRF tenants", "VLAN to VNI map", "Firewalls", "Tenant gateways", "Internet edge", "Fabric management", "Failure domains", "Failover paths",
  "Data centre two", "External peers", "As built"];
const canvas = { gridEnabled: false, snapEnabled: false, minimap: false, nodeStyle: "glyph" };
const pages = TITLES.map((title, i) => ({
  id: `p${i}`, name: `${String(i).padStart(2, "0")} · ${title}`, canvas,
  nodes: i === 0 ? [{ id: "n1", type: "device", position: { x: 0, y: 0 }, width: 76, height: 76,
    data: { label: "CHASSIS-EXAMPLE", deviceType: "access-switch", tags: [], addresses: [{ id: "a1", label: "Discovered", address: "198.51.100.100", isPrimary: true }], locked: false, maintenance: false, showDetails: true } }] : [],
  edges: [],
}));
const project = {
  meta: { id: "readable", name: "Readable", customer: "", site: "", createdAt: NOW, updatedAt: NOW },
  document: { activePageId: "p1", probes: [], pages },
};

const browser = await chromium.launch();
// The size of the window this was reported at.
const page = await (await browser.newContext({ viewport: { width: 1560, height: 880 } })).newPage();
await page.addInitScript(({ p }) => {
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback() { return next++; },
    invoke(cmd) {
      if (cmd === "plugin:event|listen") return Promise.resolve(next++);
      const meta = { id: p.meta.id, name: p.meta.name, customer: "", site: "", ticket: "", engineer: "", description: "", created_at: p.meta.createdAt, updated_at: p.meta.updatedAt, archived: false };
      if (cmd === "list_projects") return Promise.resolve([meta]);
      if (cmd === "load_project") return Promise.resolve({ meta, document_version: 1, document: p.document });
      if (cmd === "get_settings") return Promise.resolve({});
      if (cmd === "vault_status") return Promise.resolve({ exists: true, unlocked: true, credentials: 0, minimumPassphrase: 12 });
      if (cmd === "save_project") return Promise.resolve(null);
      return Promise.resolve([]);
    },
  };
}, { p: project });
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(900);

const st = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(250);

// --------------------------------------------------------- the page tabs
// What each tab shows of its name, and what it says when pointed at.
const tabs = () => st(() => {
  const strip = document.querySelector(".cv-page-tabs-scroll").getBoundingClientRect();
  return [...document.querySelectorAll(".cv-page-tab")].map((tab) => {
    const label = tab.querySelector(".cv-page-tab-name");
    const r = tab.getBoundingClientRect();
    // How wide the first twelve characters of the name are, in the tab's own type.
    const cs = getComputedStyle(label);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return {
      name: label.textContent, active: tab.classList.contains("is-active"),
      whole: label.scrollWidth <= label.clientWidth + 1,
      room: label.clientWidth, start: Math.ceil(ctx.measureText(label.textContent.slice(0, 12)).width),
      says: tab.getAttribute("title") ?? "",
      inView: r.left >= strip.left - 1 && r.right <= strip.right + 1,
    };
  });
});
{
  const all = await tabs();
  const on = all.find((t) => t.active);
  check("(the fixture: nineteen pages, more than the strip can show whole)", all.length === 19 && on?.name === "01 · Physical topology", JSON.stringify(on));
  check("the open page's tab shows its whole name", on.whole, JSON.stringify(on));
  const cut = all.filter((t) => !t.active && t.room < Math.min(t.start, 1e9) - 1 && !t.whole);
  check("every other tab keeps room for the start of its name", cut.length === 0, cut.map((t) => `${t.name}: ${t.room}px of ${t.start}px`).slice(0, 4).join("; "));
  const silent = all.filter((t) => t.says !== t.name);
  check("and says its whole name when pointed at", silent.length === 0, silent.map((t) => `${t.name} -> ${JSON.stringify(t.says)}`).slice(0, 3).join("; "));

  // Another page chosen: its tab is the one that opens out.
  await page.locator(".cv-page-tab").nth(3).click({ position: { x: 6, y: 6 } });
  await settle();
  const then = await tabs();
  const now = then.find((t) => t.active);
  check("a click on a tab opens it out to its whole name", now?.name === "03 · VXLAN overlay" && now.whole, JSON.stringify(now));

  // The last page, chosen from anywhere: its tab is brought into the strip.
  await st(() => window.__cvStore.getState().setActivePage("p18"));
  await settle();
  const last = (await tabs()).find((t) => t.active);
  check("a page chosen from elsewhere has its tab brought into view, whole", last?.name === "18 · As built" && last.inView && last.whole, JSON.stringify(last));

  // The wheel moves along the strip, which has no other way to be moved by a mouse.
  const before = await st(() => document.querySelector(".cv-page-tabs-scroll").scrollLeft);
  const box = await page.locator(".cv-page-tabs-scroll").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await settle();
  const after = await st(() => document.querySelector(".cv-page-tabs-scroll").scrollLeft);
  check("the wheel over the strip moves along it", before > 0 && after < before, `${before} -> ${after}`);
}

// ---------------------------------------------------- the inspector's fields
await st(() => { const s = window.__cvStore.getState(); s.setActivePage("p0"); });
await settle();
await st(() => window.__cvStore.getState().select("n1", null));
await settle();
const insp = page.locator(".cv-inspector");
await insp.locator('.cv-inspector-tabs button[role="tab"]', { hasText: /^Checks$/ }).click();
await settle();
const field = (sel) => st((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  return { value: el.value, whole: el.scrollWidth <= el.clientWidth + 1, width: Math.round(el.getBoundingClientRect().width), says: el.getAttribute("title") ?? "" };
}, sel);
{
  const label = await field(".cv-inspector .cv-addr .cv-addr-label");
  const address = await field(".cv-inspector .cv-addr input.cv-mono");
  check("an address's label is shown whole", label?.value === "Discovered" && label.whole, JSON.stringify(label));
  check("and the address itself", address?.value === "198.51.100.100" && address.whole, JSON.stringify(address));

  await insp.locator("button", { hasText: /^Add probe$/ }).click();
  await settle();
  const name = page.locator(".cv-inspector .cv-probe-name").first();
  await name.fill("Discovery ping");
  await settle();
  const probe = await field(".cv-inspector .cv-probe-name");
  check("a check's name is shown whole beside its buttons", probe?.value === "Discovery ping" && probe.whole, JSON.stringify(probe));
  const buttons = await st(() => [...document.querySelectorAll(".cv-inspector .cv-probe-head .cv-btn, .cv-inspector .cv-addr .cv-btn")].every((b) => {
    const r = b.getBoundingClientRect(), p = document.querySelector(".cv-inspector").getBoundingClientRect();
    return r.width > 0 && r.left >= p.left - 1 && r.right <= p.right + 1 && b.scrollWidth <= b.clientWidth + 1;
  }));
  check("and their buttons are all still there, inside the panel", buttons);

  // One too long for any panel: pointed at, it says all of it; a short one
  // says nothing it does not need to.
  const long = "2001:db8:1234:5678:9abc:def0:1234:5678 via the out-of-band management network";
  const addr = page.locator(".cv-inspector .cv-addr input.cv-mono").first();
  await addr.fill(long);
  await page.mouse.move(5, 5);
  await addr.hover();
  await settle();
  const pointed = await field(".cv-inspector .cv-addr input.cv-mono");
  check("a field too short for its value says the value when pointed at", !pointed.whole && pointed.says === long, JSON.stringify(pointed));
  await addr.fill("198.51.100.100");
  await page.mouse.move(5, 5);
  await addr.hover();
  await settle();
  const short = await field(".cv-inspector .cv-addr input.cv-mono");
  check("and stops saying it once the value fits", short.whole && short.says === "", JSON.stringify(short));
}

// -------------------------------------------------------- the rail's labels
{
  const cut = await st(() => [...document.querySelectorAll(".cv-nav-item span")].filter((s) => s.textContent.trim() && s.scrollWidth > s.clientWidth + 1).map((s) => `${s.textContent}: ${s.clientWidth} of ${s.scrollWidth}`));
  check("every label on the rail is shown whole", cut.length === 0, cut.join("; "));
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
