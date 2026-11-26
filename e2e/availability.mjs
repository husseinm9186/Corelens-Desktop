// Export → Availability report: every check's recorded history, organised
// for a customer. Driven through the real app with the Tauri bridge stubbed;
// the history is invented, the addresses are documentation addresses.
//
//     npm run dev            # in another terminal
//     node e2e/availability.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = Date.now();
const MIN = 60_000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const canvas = { gridEnabled: true, snapEnabled: true, minimap: false, nodeStyle: "glyph" };
const project = {
  meta: { id: "avail", name: "Campus core", customer: "Example Customer", site: "Main site", createdAt: NOW, updatedAt: NOW },
  document: { activePageId: "p1", probes: [], pages: [{ id: "p1", name: "Core", canvas, nodes: [], edges: [] }] },
};

// Wire format of list_events: snake_case rows.
let n = 0;
const row = (objectId, objectName, ago, from, to, message, target = "192.0.2.10") => ({
  id: `e${++n}`, project_id: "avail", session_id: "s1", timestamp_ms: NOW - ago, object_type: "node", object_id: objectId,
  object_name: objectName, event_type: "transition", previous_status: from, current_status: to, probe_type: "tcp", target, rtt_ms: null, message,
});
const history = [
  ...["Portal", "Mail", "Files"].flatMap((s, i) => [
    row(s, `PROD · ${s} · app${i}:443`, 120 * MIN, "unknown", "healthy", "Connected to port 443, 20 ms", `198.51.100.${i + 1}`),
    row(s, `PROD · ${s} · app${i}:443`, 60 * MIN - i * 1000, "healthy", "down", "Connection timed out", `198.51.100.${i + 1}`),
    row(s, `PROD · ${s} · app${i}:443`, 58 * MIN - i * 1000, "down", "healthy", "Connected to port 443, 21 ms", `198.51.100.${i + 1}`),
  ]),
  row("sw1", "CORE-SW1", 120 * MIN, "unknown", "healthy", "Reply, 2 ms", "192.0.2.1"),
  row("old", "OLD-SW", 120 * MIN, "unknown", "down", "Request timed out", "192.0.2.99"),
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.addInitScript(({ p, history }) => {
  const listeners = {}, callbacks = {};
  let next = 1;
  window.__exports = [];
  window.__asked = [];
  window.__history = history;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) { const id = next++; callbacks[id] = cb; return id; },
    invoke(cmd, args) {
      if (cmd === "plugin:event|listen") { listeners[args.event] = args.handler; return Promise.resolve(next++); }
      const meta = { id: p.meta.id, name: p.meta.name, customer: p.meta.customer, site: p.meta.site, ticket: "", engineer: "", description: "", created_at: p.meta.createdAt, updated_at: p.meta.updatedAt, archived: false };
      if (cmd === "list_projects") return Promise.resolve([meta]);
      if (cmd === "load_project") return Promise.resolve({ meta, document_version: 1, document: p.document });
      if (cmd === "get_settings") return Promise.resolve({});
      if (cmd === "vault_status") return Promise.resolve({ exists: true, unlocked: true, credentials: 0, minimumPassphrase: 12 });
      if (cmd === "list_events") { window.__asked.push(args); return Promise.resolve(window.__history); }
      if (cmd === "pick_export_target") { window.__names = [...(window.__names ?? []), args.filename]; } if (cmd === "pick_export_target") return Promise.resolve({ token: `t-${next++}`, path: `/tmp/${args.filename}` });
      if (cmd === "save_export") {
        const bytes = Uint8Array.from(atob(args.contentsB64), (c) => c.charCodeAt(0));
        window.__exports.push({ path: args.path, text: new TextDecoder().decode(bytes) });
        return Promise.resolve(null);
      }
      if (cmd === "save_project") return Promise.resolve(null);
      return Promise.resolve([]);
    },
  };
}, { p: project, history });
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(800);

const st = (fn, arg) => page.evaluate(fn, arg);
const menu = page.locator(".cv-dropdown").filter({ has: page.locator("summary", { hasText: "Export" }) });
await menu.locator("summary").click();
await page.waitForTimeout(150);
check("Export offers the availability report beside the events", (await menu.locator('[data-export="availability"]').count()) === 1);
await menu.locator('[data-export="availability"]').click();
await page.waitForTimeout(800);

const asked = await st(() => window.__asked);
check("it reads the whole recorded history, not only what the dock loaded", asked.some((a) => a.limit >= 100000), JSON.stringify(asked));
const out = (await st(() => window.__exports)).at(-1);
const names = await st(() => window.__names ?? []);
check("one HTML file named for the project", names.at(-1) === "campus-core-availability.html" && Boolean(out), JSON.stringify(names));
const html = out?.text ?? "";
const viewer = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const fetched = [];
viewer.on("request", (r) => { if (!/^(data|about):/.test(r.url())) fetched.push(r.url()); });
await viewer.setContent(html, { waitUntil: "load" });
check("it names the customer, project and site", /Example Customer · Campus core · Main site/.test(await viewer.locator(".sub").textContent()));
const tiles = await viewer.locator('[data-part="tiles"] .tile b').allTextContents();
check("the tiles count what happened", tiles.join(",") === "5,4,1,3,1", tiles.join(","));
check("the three outages that began together are one wide event",
  (await viewer.locator('[data-part="wide"] tr').count()) === 4);
check("what was down throughout is listed apart", /OLD-SW/.test(await viewer.locator('[data-part="always-down"]').textContent()));
const groups = await viewer.locator('[data-part="availability"] th[colspan]').allTextContents();
check("the checks are grouped, devices last", groups.join("|") === "PROD|Devices", groups.join("|"));
const portal = viewer.locator('[data-check="PROD · Portal · app0:443"] tr');
const rows = await portal.allTextContents();
check("each check has its timeline, newest first, with how long each state lasted",
  rows.length === 3 && /Up.*58m/.test(rows[0]) && /Down.*2m/.test(rows[1]) && /Up.*1h/.test(rows[2]), JSON.stringify(rows));
check("and nothing in it is fetched from anywhere", fetched.length === 0, fetched.join(", "));
await viewer.close();

// Nothing recorded: said, and nothing written.
await st(() => { window.__history = []; window.__exports = []; });
await menu.locator("summary").click();
await page.waitForTimeout(150);
await menu.locator('[data-export="availability"]').click();
await page.waitForTimeout(500);
check("with no history it says so and writes nothing",
  (await st(() => window.__exports)).length === 0 && /nothing to report/.test(await st(() => window.__cvStore.getState().statusMessage ?? "")));

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
