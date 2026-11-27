// Import… → From a project: another project's pages added to the open one,
// with fresh ids, or the file opened as a project of its own. Driven through
// the real app with the Tauri bridge stubbed. Invented names, documentation
// addresses.
//
//     npm run dev            # in another terminal
//     node e2e/importproject.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const dev = (id, label, x, address, extra = {}) => ({
  id, type: "device", position: { x, y: 0 }, width: 76, height: 76,
  data: { label, deviceType: "access-switch", tags: [], locked: false, maintenance: false, showDetails: true,
    addresses: [{ id: `${id}-a`, label: "Management", address, isPrimary: true }], ...extra },
});
const link = (id, source, target) => ({ id, source, target, type: "live",
  data: { sourcePortLabel: "", targetPortLabel: "", label: "", enabled: true, maintenance: false, isPrimary: false, healthRule: { type: "both-endpoints" } } });
const canvas = { gridEnabled: true, snapEnabled: true, minimap: false, nodeStyle: "glyph" };
const probe = (id, projectId, objectId, target) => ({ id, projectId, objectKind: "node", objectId, name: "Ping", kind: "icmp", target,
  intervalSeconds: 5, timeoutMs: 1000, failureThreshold: 3, recoveryThreshold: 2, enabled: true, maintenance: false, isPrimary: true });

// The open project.
const project = {
  meta: { id: "here", name: "Main site", createdAt: NOW, updatedAt: NOW },
  document: {
    activePageId: "p1",
    probes: [probe("pr1", "here", "a", "192.0.2.10")],
    pages: [{ id: "p1", name: "Core", canvas, nodes: [dev("a", "CORE-SW1", 0, "192.0.2.10"), dev("b", "EDGE-RTR1", 300, "192.0.2.1")], edges: [link("ab", "a", "b")] }],
  },
};

// The file: the same ids and a page name already taken, two pages.
const other = (withVault) => ({
  meta: { id: "there", name: "Second site", customer: "", site: "", createdAt: NOW, updatedAt: NOW },
  documentVersion: 1,
  document: {
    activePageId: "q1",
    probes: [probe("pr1", "there", "a", "198.51.100.10"), probe("pr2", "there", "c", "198.51.100.30")],
    pages: [
      { id: "q1", name: "Core", canvas, nodes: [{ ...dev("a", "DC2-CORE", 0, "198.51.100.10"), data: { ...dev("a", "DC2-CORE", 0, "198.51.100.10").data, sshCredentialId: "cred-old-1" } }, dev("b", "DC2-EDGE", 300, "198.51.100.1")], edges: [link("ab", "a", "b")] },
      { id: "q2", name: "Branch", canvas, nodes: [dev("c", "BR2-SW1", 0, "198.51.100.30")], edges: [] },
    ],
  },
  ...(withVault ? { vault: { sealed: "not a real vault" } } : {}),
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.addInitScript(({ p, file }) => {
  const listeners = {}, callbacks = {};
  let next = 1;
  window.__calls = [];
  window.__file = file;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) { const id = next++; callbacks[id] = cb; return id; },
    invoke(cmd, args) {
      if (cmd === "plugin:event|listen") { listeners[args.event] = args.handler; return Promise.resolve(next++); }
      window.__calls.push({ cmd, args });
      const meta = { id: p.meta.id, name: p.meta.name, customer: "", site: "", ticket: "", engineer: "", description: "", created_at: p.meta.createdAt, updated_at: p.meta.updatedAt, archived: false };
      if (cmd === "list_projects") return Promise.resolve([meta]);
      if (cmd === "load_project") return Promise.resolve({ meta, document_version: 1, document: p.document });
      if (cmd === "get_settings") return Promise.resolve({});
      if (cmd === "vault_status") return Promise.resolve({ exists: true, unlocked: true, credentials: 0, minimumPassphrase: 12 });
      if (cmd === "plugin:dialog|open") return Promise.resolve("/home/user/second-site.corelens");
      if (cmd === "read_import") return Promise.resolve(JSON.stringify(window.__file));
      if (cmd === "save_project") return window.__failSave ? Promise.reject("The disk is full.") : Promise.resolve(null);
      if (cmd === "set_open_project") { window.__open = args.projectId ?? null; return Promise.resolve(null); }
      // As Rust answers: the passphrase is tried before anything else; a
      // check writes nothing; a login is written into the open project only.
      if (cmd === "import_vault") {
        if (args.passphrase !== "exporting-vault-passphrase") return Promise.reject("The passphrase is wrong.");
        if (args.checkOnly) return Promise.resolve({ count: 2, ids: {} });
        if (!window.__open) return Promise.reject("Open a project first: a saved login belongs to one project.");
        window.__imported = [...(window.__imported ?? []), window.__open, window.__open];
        // Re-sealed under fresh ids, as Rust does, and said which.
        const n = window.__imported.length;
        return Promise.resolve({ count: 2, ids: { "cred-old-1": `cred-new-${n - 1}`, "cred-old-2": `cred-new-${n}` } });
      }
      return Promise.resolve([]);
    },
  };
}, { p: project, file: other(false) });
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(800);

const st = (fn, arg) => page.evaluate(fn, arg);
const doc = () => st(() => window.__cvStore.getState().doc);
const dialog = page.locator('[data-region="import-dialog"]');

const openFromProject = async () => {
  await page.locator('[data-region="import"]').first().click();
  await page.waitForTimeout(250);
  await dialog.locator('[data-source="project"]').click();
  await page.waitForTimeout(200);
  await dialog.locator('[data-action="pick-project"]').click();
  await page.waitForTimeout(300);
};

// --- As pages -------------------------------------------------------------
await page.locator('[data-region="import"]').first().click();
await page.waitForTimeout(250);
check("Import… offers From a project beside the file and the drawing",
  (await dialog.locator("[data-source]").evaluateAll((els) => els.map((e) => e.dataset.source))).join(",") === "csv,visio,project");
await dialog.locator(".cv-import-close").click();
await openFromProject();
const listed = await dialog.locator(".cv-project-import-pages li").allTextContents();
check("the file's pages are listed with what is on them, all ticked",
  listed.length === 2 && /Core.*2 devices.*1 link/.test(listed[0]) && /Branch.*1 device.*0 links/.test(listed[1])
  && (await dialog.locator(".cv-project-import-pages input:checked").count()) === 2, JSON.stringify(listed));
check("a file with no credentials says nothing about them", (await dialog.locator('[data-note="credentials"]').count()) === 0);

await dialog.locator('input[data-page="Branch"]').uncheck();
check("the button counts the pages ticked", /Add 1 page to this project/.test(await dialog.locator('[data-action="import-as-pages"]').textContent()));
await dialog.locator('input[data-page="Branch"]').check();
await dialog.locator('[data-action="import-as-pages"]').click();
await page.waitForTimeout(400);

let d = await doc();
check("the dialog closes and the pages are added after this project's, under names not taken",
  (await dialog.count()) === 0 && d.pages.map((pg) => pg.name).join("|") === "Core|Core 2|Branch", d.pages.map((pg) => pg.name).join("|"));
check("the first page added is the one shown", d.activePageId === d.pages[1].id);
const nodes = d.pages.flatMap((pg) => pg.nodes);
const ids = nodes.map((n) => n.id).concat(d.pages.flatMap((pg) => pg.edges.map((e) => e.id)));
check("every device and link has an id of its own", new Set(ids).size === ids.length, ids.join(","));
check("what was here is untouched", d.pages[0].nodes.map((n) => `${n.id}:${n.data.label}`).join(",") === "a:CORE-SW1,b:EDGE-RTR1");
const added = d.pages[1];
const e = added.edges[0];
check("the link added joins the devices added", e.source === added.nodes[0].id && e.target === added.nodes[1].id);
const newProbes = d.probes.filter((pr) => pr.target.startsWith("198.51.100."));
check("the file's checks come with the devices, in this project", newProbes.length === 2 && newProbes.every((pr) => pr.projectId === "here" && nodes.some((n) => n.id === pr.objectId && n.data.addresses[0].address === pr.target)) && d.probes.length === 3, JSON.stringify(newProbes.map((pr) => [pr.objectId, pr.target])));
check("the status line says what came", /Added 2 pages from Second site: 3 devices, 1 link, 2 checks/.test(await page.locator(".cv-statusbar, .cv-status-message, [role=status]").allTextContents().then((t) => t.join(" "))) ||
  /Added 2 pages from Second site/.test(await st(() => window.__cvStore.getState().statusMessage ?? "")));

await st(() => window.__cvStore.getState().undo());
await page.waitForTimeout(250);
d = await doc();
check("one Undo takes the import back", d.pages.length === 1 && d.probes.length === 1);

// --- As pages, with the file's saved logins --------------------------------
await st(() => { window.__file = { ...window.__file, vault: { sealed: "not a real vault" } }; });
await openFromProject();
check("a file that carries saved logins asks for their passphrase beside the pages", (await dialog.locator('[data-note="credentials"] [data-field="import-passphrase"]').count()) === 1);
await dialog.locator('[data-field="import-passphrase"]').fill("not-the-right-one");
await dialog.locator('[data-action="import-as-pages"]').click();
await page.waitForTimeout(400);
check("a wrong passphrase is said, and no page is added", /passphrase is wrong/.test(await dialog.innerText()) && (await doc()).pages.length === 1 && !(await st(() => window.__imported?.length)));
await dialog.locator('[data-field="import-passphrase"]').fill("exporting-vault-passphrase");
await dialog.locator('[data-action="import-as-pages"]').click();
await page.waitForTimeout(600);
d = await doc();
const core2 = d.pages.find((pg) => pg.name !== "Core" && pg.nodes.some((n) => n.data.label === "DC2-CORE"))?.nodes.find((n) => n.data.label === "DC2-CORE");
check("the right one brings the logins into this project with the pages", d.pages.length === 3 && JSON.stringify(await st(() => window.__imported)) === '["here","here"]', JSON.stringify(await st(() => window.__imported)));
check("and the device that used one points at the id it has here", core2?.data.sshCredentialId === "cred-new-1", JSON.stringify(core2?.data));
check("the status line counts the logins too", /and 2 credentials re-sealed/.test(await st(() => window.__cvStore.getState().statusMessage ?? "")), await st(() => window.__cvStore.getState().statusMessage ?? ""));
await st(() => window.__cvStore.getState().undo());
await page.waitForTimeout(250);
await st(() => { window.__imported = []; });

// --- As a separate project ------------------------------------------------
await openFromProject();
await st(() => { window.__calls = []; });
await dialog.locator('[data-action="import-as-project"]').click();
await page.waitForTimeout(900);
check("this project is closed and the start screen asks about the file's credentials",
  (await st(() => window.__cvStore.getState().meta)) === null && (await page.locator(".cv-import-vault").count()) === 1);
await page.locator(".cv-import-vault button", { hasText: "Skip them" }).click();
await page.waitForTimeout(800);
const saved = (await st(() => window.__calls.filter((c) => c.cmd === "save_project").map((c) => c.args)));
const made = saved.at(-1)?.project ?? saved.at(-1)?.input ?? saved.at(-1);
const madeName = JSON.stringify(made ?? {}).match(/"name":"(Second site \(imported\))"/)?.[1];
check("and the file opens as a project of its own", madeName === "Second site (imported)" && (await st(() => window.__cvStore.getState().meta?.name)) === "Second site (imported)",
  JSON.stringify(made ?? {}).slice(0, 200));
check("with both its pages", (await doc()).pages.map((pg) => pg.name).join("|") === "Core|Branch");

// --- Its credentials, taken ------------------------------------------------
await st(() => { window.__file = { ...window.__file, document: { ...window.__file.document, credentialDefaults: { ssh: "cred-old-2" } } }; });
await openFromProject();
await dialog.locator('[data-action="import-as-project"]').click();
await page.waitForTimeout(900);
const box = page.locator(".cv-import-vault");
await box.locator('input[type="password"]').fill("not-the-right-one");
await box.locator("button", { hasText: "Import credentials" }).click();
await page.waitForTimeout(500);
check("a wrong passphrase is said where it was typed, and nothing is made",
  /passphrase is wrong/.test(await box.innerText()) && (await st(() => window.__cvStore.getState().meta)) === null && !(await st(() => window.__imported?.length)));
await box.locator('input[type="password"]').fill("exporting-vault-passphrase");
await box.locator("button", { hasText: "Import credentials" }).click();
await page.waitForTimeout(900);
const newId = await st(() => window.__cvStore.getState().meta?.id);
check("the right one opens the project and its credentials come into it",
  Boolean(newId) && newId !== "here" && JSON.stringify(await st(() => window.__imported)) === JSON.stringify([newId, newId]),
  JSON.stringify({ newId, imported: await st(() => window.__imported), note: await box.innerText().catch(() => "") }));
check("and the status line says how many", /Imported 2 credentials/.test(await st(() => window.__cvStore.getState().statusMessage ?? "")));
const opened = await doc();
check("the project's own login and its device's point at the ids they have here, so none is forgotten",
  opened.credentialDefaults?.ssh === "cred-new-2" && opened.pages[0].nodes.find((n) => n.data.label === "DC2-CORE")?.data.sshCredentialId === "cred-new-1",
  JSON.stringify({ defaults: opened.credentialDefaults, dev: opened.pages[0].nodes.find((n) => n.data.label === "DC2-CORE")?.data.sshCredentialId }));

// --- The passphrase is right and the project cannot be made ----------------
await openFromProject();
await dialog.locator('[data-action="import-as-project"]').click();
await page.waitForTimeout(900);
await st(() => { window.__failSave = true; });
await box.locator('input[type="password"]').fill("exporting-vault-passphrase");
await box.locator("button", { hasText: "Import credentials" }).click();
await page.waitForTimeout(900);
check("a project that cannot be made is said, not left to silence",
  /The disk is full/.test(await page.locator(".cv-welcome").innerText()) && (await st(() => window.__cvStore.getState().meta)) === null,
  (await page.locator(".cv-welcome [role=alert]").allInnerTexts()).join(" | "));
await st(() => { window.__failSave = false; });

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
