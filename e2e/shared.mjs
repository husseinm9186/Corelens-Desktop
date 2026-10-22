// Projects kept in a company folder every engineer's machine sees: the
// start screen lists what is there, a project not yet on this machine is
// brought over under its own id and opened, every save writes the shared
// copy, a newer shared copy is what opens, a lock held by a colleague is a
// banner, and the settings rows and the create tick do what they say.
// Stubbed backend; invented names and paths only.
//
//     npm run dev            # in another terminal
//     node e2e/shared.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;
const ROOT = "/home/example/Company/Network projects";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const device = (id, label) => ({
  id, type: "device", position: { x: 0, y: 0 }, width: 76, height: 76,
  data: { label, deviceType: "access-switch", tags: [], addresses: [], locked: false, maintenance: false, showDetails: true },
});
const meta = (id, name, updatedAt, over = {}) =>
  ({ id, name, customer: "Example Co", site: "Branch 12", ticket: "", engineer: "", description: "", createdAt: NOW, updatedAt, archived: false, ...over });
const doc = (label) => ({ nodes: [device("n1", label)], edges: [], probes: [], canvas: {} });

// On this machine: one plain project, and one kept in the folder whose
// shared copy a colleague has saved since.
const local = [
  { meta: meta("p-local", "Local only", NOW), documentVersion: 1, document: doc("LOCAL-SW") },
  { meta: meta("p-kept", "Kept project", NOW), documentVersion: 1, document: doc("STALE-SW") },
];
// In the folder: the kept project's newer copy, and one not here yet,
// which a colleague has open.
const shared = {
  [`${ROOT}/kept-project`]: { meta: meta("p-kept", "Kept project", NOW + 5000), documentVersion: 1, document: doc("FROM-SHARED") },
  [`${ROOT}/branch-12`]: { meta: meta("p-shared", "Branch 12 refresh", NOW + 1000), documentVersion: 1, document: doc("SHARED-SW") },
};
const lock = { engineer: "alex", machine: "desk-7", since_ms: NOW - 60000, seen_ms: NOW, mine: false, stale: false };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.addInitScript(({ local, shared, lock, ROOT }) => {
  const saved = new Map(local.map((p) => [p.meta.id, p]));
  const app = { sharedProjectsFolder: ROOT };
  const perProject = { "p-kept": { projectFolder: `${ROOT}/kept-project` } };
  window.__calls = [];
  let next = 1;
  const snake = (m) => ({ ...m, created_at: m.createdAt, updated_at: m.updatedAt });
  const folderOf = (id) => perProject[id]?.projectFolder;
  const lockFor = (folder) => (folder === `${ROOT}/branch-12` ? lock : null);
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback() { return next++; },
    invoke(cmd, args = {}) {
      window.__calls.push({ cmd, args });
      if (cmd === "plugin:event|listen") return Promise.resolve(next++);
      if (cmd === "list_projects") return Promise.resolve([...saved.values()].map((p) => snake(p.meta)));
      if (cmd === "save_project") { saved.set(args.package.meta.id, { meta: args.package.meta, documentVersion: 1, document: args.package.document }); return Promise.resolve(null); }
      if (cmd === "load_project") { const p = saved.get(args.id); return Promise.resolve(p ? { meta: snake(p.meta), document_version: 1, document: p.document } : null); }
      if (cmd === "get_settings") return Promise.resolve({ ...app, ...(args.projectId ? perProject[args.projectId] ?? {} : {}) });
      if (cmd === "set_setting") {
        if (args.key === "projectFolder") { perProject[args.projectId] = { ...(perProject[args.projectId] ?? {}) }; if (args.value) perProject[args.projectId].projectFolder = args.value; else delete perProject[args.projectId].projectFolder; }
        else if (args.value) app[args.key] = args.value; else delete app[args.key];
        return Promise.resolve();
      }
      if (cmd === "check_folder_writable") return Promise.resolve();
      if (cmd === "plugin:dialog|open") return Promise.resolve(ROOT);
      if (cmd === "list_shared_projects") return Promise.resolve(Object.entries(shared).map(([folder, p]) => ({ folder, ...p.meta, updated_at: p.meta.updatedAt, lock: lockFor(folder) })));
      if (cmd === "adopt_shared_project") { const p = shared[args.folder]; if (!p) return Promise.reject(`${args.folder} is not a project folder inside ${ROOT}.`); perProject[p.meta.id] = { projectFolder: args.folder }; return Promise.resolve(JSON.stringify(p)); }
      if (cmd === "kept_project_status") { const f = folderOf(args.projectId); if (!f) return Promise.resolve(null); const p = shared[f]; return Promise.resolve({ folder: f, exists: Boolean(p), updated_at: p ? p.meta.updatedAt : null, lock: lockFor(f) }); }
      if (cmd === "read_kept_project") { const p = shared[folderOf(args.projectId)]; return p ? Promise.resolve(JSON.stringify(p)) : Promise.reject("missing"); }
      if (cmd === "keep_project") { const f = folderOf(args.projectId); if (!f) return Promise.reject("This project is not kept in a shared folder."); shared[f] = JSON.parse(args.json); return Promise.resolve({ folder: f, overwrote: null, lock: { engineer: "me", machine: "here", since_ms: 1, seen_ms: 2, mine: true, stale: false } }); }
      if (cmd === "keep_project_lock") { const f = folderOf(args.projectId); return Promise.resolve(f ? (lockFor(f) ?? { engineer: "me", machine: "here", since_ms: 1, seen_ms: 2, mine: true, stale: false }) : null); }
      if (cmd === "release_project_lock" || cmd === "unlink_project_folder") { if (cmd === "unlink_project_folder") delete perProject[args.projectId]?.projectFolder; return Promise.resolve(); }
      if (cmd === "link_project_folder") { const f = `${ROOT}/${args.name}`; perProject[args.projectId] = { ...(perProject[args.projectId] ?? {}), projectFolder: f }; return Promise.resolve(f); }
      if (cmd === "vault_status") return Promise.resolve({ exists: false, unlocked: false, credentials: 0, minimumPassphrase: 12 });
      return Promise.resolve([]);
    },
  };
}, { local, shared, lock, ROOT });
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(600);

const st = (fn, arg) => page.evaluate(fn, arg);
const calls = (cmd) => page.evaluate((c) => window.__calls.filter((x) => x.cmd === c).map((x) => x.args), cmd);
const lastCall = async (cmd) => (await calls(cmd)).at(-1);

// ------------------------------------------------------------ the start screen
const section = page.locator('[data-region="shared-projects"]');
check("the start screen has the shared folder's section, naming the folder", (await section.count()) === 1 && (await section.locator('[data-region="shared-folder"]').textContent()) === ROOT);
const rows = section.locator(".cv-shared-row");
check("with every project kept there, by name", (await rows.count()) === 2 && (await rows.allInnerTexts()).join(" | ").includes("Branch 12 refresh") && (await rows.allInnerTexts()).join(" | ").includes("Kept project"), (await rows.allInnerTexts()).join(" | "));
const away = rows.filter({ hasText: "Branch 12 refresh" });
const here = rows.filter({ hasText: "Kept project" });
check("one not on this machine offers to bring it over", /Open from the shared folder/.test(await away.locator("button").textContent()) && !/on this machine/.test(await away.innerText()));
check("one already here says so and opens", /on this machine/.test(await here.innerText()) && (await here.locator("button").textContent()) === "Open");
check("a colleague's lock is named on the row", /alex on desk-7 has this project open since/.test(await away.locator('[data-region="shared-held"]').textContent()));
check("the folder itself is this computer's setting, offered on the start screen", (await section.locator("button", { hasText: "Change" }).count()) === 1);

// ------------------------------------------------------------ bringing one over
await away.locator("button").click();
await page.waitForTimeout(800);
check("Open from the shared folder adopts that folder", (await lastCall("adopt_shared_project"))?.folder === `${ROOT}/branch-12`);
check("saves the project here under its own id", (await calls("save_project")).some((a) => a.package.meta.id === "p-shared" && a.package.meta.name === "Branch 12 refresh"));
check("and opens it", (await st(() => window.__cvStore.getState().meta?.id)) === "p-shared");
check("with the shared copy's diagram", (await st(() => window.__cvStore.getState().doc.pages?.[0]?.nodes?.[0]?.data?.label ?? window.__cvStore.getState().doc.nodes?.[0]?.data?.label)) === "SHARED-SW");
check("the project's folder was remembered, so the lock was taken", (await calls("keep_project_lock")).some((a) => a.projectId === "p-shared"));
const banner = page.locator('[data-region="shared-notice"]');
check("and the colleague's lock is a banner, saying the later save wins", (await banner.count()) === 1 && /alex on desk-7 has this project open since .* If you both save, the later save wins\./.test(await banner.textContent()), await banner.textContent().catch(() => "none"));

// ------------------------------------------------------------ a save writes the shared copy
const keptBefore = (await calls("keep_project")).length;
await st(() => { window.__cvStore.getState().updateMeta({ description: "edited here" }); });
await st(() => window.__cvStore.getState().saveProject());
await page.waitForTimeout(300);
// The first write since the open; the autosave may have added another.
const kept = (await calls("keep_project"))[keptBefore];
check("a save writes the shared copy — the folder is Rust's to know, the page sends only the files", kept?.projectId === "p-shared" && typeof kept.json === "string" && kept.json.includes('"edited here"') && typeof kept.yaml === "string" && kept.yaml.includes("edited here") && !("folder" in kept), JSON.stringify(Object.keys(kept ?? {})));
check("telling Rust which shared copy this machine last saw", typeof kept?.knownUpdatedAt === "number" && kept.knownUpdatedAt === NOW + 1000, String(kept?.knownUpdatedAt));
check("and never the vault", !kept.json.includes("vault"));

// ------------------------------------------------------------ closing releases; opening reads the newer copy
await st(() => window.__cvStore.getState().closeProject());
await page.waitForTimeout(500);
check("closing releases this machine's lock", (await lastCall("release_project_lock"))?.projectId === "p-shared");
await page.locator(".cv-project-card", { hasText: "Kept project" }).locator(".cv-project-open").click();
await page.waitForTimeout(800);
check("a kept project whose shared copy is newer opens the shared copy", (await st(() => window.__cvStore.getState().meta?.id)) === "p-kept" && (await st(() => window.__cvStore.getState().doc.pages?.[0]?.nodes?.[0]?.data?.label ?? window.__cvStore.getState().doc.nodes?.[0]?.data?.label)) === "FROM-SHARED");
check("replacing this machine's copy", (await calls("save_project")).some((a) => a.package.meta.id === "p-kept" && (a.package.meta.updated_at ?? a.package.meta.updatedAt) === NOW + 5000));
check("and the status line says whose it was", /Opened the shared copy saved/.test(await st(() => window.__cvStore.getState().statusMessage ?? "")), await st(() => window.__cvStore.getState().statusMessage));
check("no banner: nobody else has it open", (await banner.count()) === 0);

// ------------------------------------------------------------ settings
await page.locator(".cv-nav-item", { hasText: /^Settings$/ }).click();
await page.waitForTimeout(500);
const appShared = page.locator('[data-region="shared-settings"]');
check("Settings → Application has the shared projects folder", (await appShared.count()) === 1 && (await appShared.locator("code").textContent()) === ROOT);
check("and says what never goes there", /Saved logins never go there/.test(await appShared.innerText()));
const copy = page.locator('[data-region="shared-copy"]');
check("this project's Folders show its shared copy", (await copy.locator("code").textContent()) === `${ROOT}/kept-project` && (await copy.locator("button", { hasText: "Stop keeping" }).count()) === 1);
await copy.locator("button", { hasText: "Stop keeping" }).click();
await page.waitForTimeout(400);
check("Stop keeping unlinks the folder and leaves the files", (await lastCall("unlink_project_folder"))?.projectId === "p-kept" && /Not kept in the shared folder/.test(await copy.locator("code").textContent()));
const before = (await calls("keep_project")).length;
await copy.locator("button", { hasText: "Keep in the shared folder" }).click();
await page.waitForTimeout(600);
check("Keep in the shared folder makes a folder named after the project and writes it", (await lastCall("link_project_folder"))?.name === "kept-project" && (await calls("keep_project")).length === before + 1 && (await lastCall("keep_project"))?.projectId === "p-kept", JSON.stringify(await lastCall("link_project_folder")));
check("and shows where", (await copy.locator("code").textContent()) === `${ROOT}/kept-project`);

// ------------------------------------------------------------ creating one, kept from the start
await st(() => window.__cvStore.getState().closeProject());
await page.waitForTimeout(500);
await page.locator("button", { hasText: /^Create project$/ }).first().click();
await page.waitForTimeout(300);
const tick = page.locator('[data-region="create-keep-shared"] input');
check("the create dialog offers to keep the new project in the shared folder, ticked", (await tick.count()) === 1 && (await tick.isChecked()));
await page.locator(".cv-modal input.cv-input").first().fill("New shared one");
await page.locator(".cv-modal button", { hasText: /^Create project$/ }).click();
await page.waitForTimeout(800);
check("created, it is linked under its name and written", (await lastCall("link_project_folder"))?.name === "new-shared-one" && (await lastCall("keep_project"))?.json.includes("New shared one"));

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
