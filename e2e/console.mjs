// A serial console in the terminal panel, the port found automatically.
//
// The backend is a stand-in: it lists whatever ports the check sets, and a
// console "opens" by handing back an id. What is driven for real is the
// window — which port it asks for, at what speed, what it says when it will
// not guess, and that a console is typed into, broken and reopened like the
// session it is. Listing, ranking and the port itself are covered by the
// Rust tests in `corelens-discover/src/console.rs`.
//
//     npm run dev
//     node e2e/console.mjs
import { chromium } from "playwright";

const URL = process.env.CV_URL ?? "http://localhost:5173/";
const NOW = 1756000000000;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `  ${detail}` : ""}`); }
};

const project = {
  meta: { id: "con", name: "Console", customer: "", site: "", ticket: "", engineer: "",
    description: "", createdAt: NOW, updatedAt: NOW, archived: false },
  documentVersion: 1,
  document: {
    activePageId: "p1", probes: [],
    pages: [{ id: "p1", name: "Core",
      canvas: { gridEnabled: true, snapEnabled: true, minimap: false, nodeStyle: "glyph" },
      edges: [],
      nodes: [{ id: "a", type: "device", position: { x: 0, y: 0 }, width: 76, height: 76,
        // No address and no login: a console needs neither.
        data: { label: "NEW-SW1", deviceType: "core-switch", tags: [], addresses: [] } }] }],
  },
};

const CABLE = { name: "/dev/ttyUSB0", kind: "usb", description: "FT232R USB UART (FTDI)", likelyConsole: true };
const SECOND = { name: "/dev/ttyUSB1", kind: "usb", description: "USB serial adapter (Prolific)", likelyConsole: true };
const BUILT_IN = { name: "/dev/ttyS0", kind: "unknown", description: "Serial port", likelyConsole: false };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });

await page.addInitScript(({ p }) => {
  const listeners = {}, callbacks = {};
  let next = 1, sessions = 0;
  window.__ports = [];      // what the machine has, set by each check
  window.__listed = 0;      // console_ports calls
  window.__opened = [];     // every console_open payload
  window.__sent = [];       // every ssh_send payload, decoded
  window.__breaks = [];     // every console_break id
  window.__closed = [];
  window.__other = [];      // anything else that would reach a device
  window.__settings = {};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  const say = (payload) => {
    const handler = listeners["corelens://ssh"];
    if (handler && callbacks[handler]) callbacks[handler]({ event: "corelens://ssh", id: handler, payload });
  };
  window.__fromDevice = (id, text) => say({ kind: "data", id, bytes: btoa(text) });
  window.__lost = (id, reason) => say({ kind: "closed", id, reason });
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) { const id = next++; callbacks[id] = cb; return id; },
    invoke(cmd, args) {
      if (cmd === "plugin:event|listen") { listeners[args.event] = args.handler; return Promise.resolve(next++); }
      const meta = { id: p.meta.id, name: p.meta.name, customer: "", site: "", ticket: "",
        engineer: "", description: "", created_at: p.meta.createdAt, updated_at: p.meta.updatedAt, archived: false };
      if (/^(start_|ssh_open|get_device_info|ping_from|traceroute_from|test_credential)/.test(cmd)) window.__other.push(cmd);
      if (cmd === "list_projects") return Promise.resolve([meta]);
      if (cmd === "load_project") return Promise.resolve({ meta, document_version: p.documentVersion, document: p.document });
      if (cmd === "vault_status") return Promise.resolve({ exists: true, unlocked: true, credentials: 0, minimumPassphrase: 12, keptInKeychain: true });
      if (cmd === "console_ports") {
        window.__listed += 1;
        const likely = window.__ports.filter((x) => x.likelyConsole);
        return Promise.resolve({ ports: window.__ports, chosen: likely.length === 1 ? likely[0].name : null });
      }
      if (cmd === "console_open") {
        window.__opened.push(args);
        if (args.port === "/dev/ttyS0") return Promise.reject("/dev/ttyS0 could not be opened: this account may not use serial ports.");
        sessions += 1;
        return Promise.resolve(`console-${sessions}`);
      }
      if (cmd === "console_break") { window.__breaks.push(args.id); return Promise.resolve(); }
      if (cmd === "ssh_send") { window.__sent.push({ id: args.id, text: atob(args.bytes) }); return Promise.resolve(); }
      if (cmd === "ssh_close") { window.__closed.push(args.id); return Promise.resolve(); }
      if (cmd === "ssh_sessions") return Promise.resolve([]);
      if (cmd === "get_settings") return Promise.resolve({ ...window.__settings });
      if (cmd === "set_setting") {
        if (args.value === null || args.value === undefined) delete window.__settings[args.key];
        else window.__settings[args.key] = args.value;
        return Promise.resolve();
      }
      if (cmd === "save_project") return Promise.resolve();
      return Promise.resolve([]);
    },
  };
}, { p: project });

page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator(".cv-project-open").first().click();
await page.waitForTimeout(900);

const st = (fn, arg) => page.evaluate(fn, arg);
const message = () => page.locator(".cv-panel-message").textContent().catch(() => "");
const bar = page.locator('[data-region="console"]');
const consoleButton = bar.locator("button", { hasText: "Console" });
const portSelect = bar.locator("select").nth(0);
const speedSelect = bar.locator("select").nth(1);
const tabs = () => page.locator(".cv-ssh-tab [role=tab]").evaluateAll((els) => els.map((e) => e.textContent.trim()));

// The SSH tab is for shells: nothing of the console's is on it.
await st(() => window.__cvStore.getState().requestPanelTab("ssh"));
await page.waitForTimeout(400);
check("the SSH tab carries no console controls", (await page.locator('[data-region="console"]').count()) === 0);
const dockTab = (name) => page.locator(".cv-panel-tabs [role=tab], .cv-panel-tabs button", { hasText: name }).first();
check("the dock has a Console tab of its own, beside SSH", (await dockTab("Console").count()) === 1 && (await dockTab("SSH").count()) === 1);
await dockTab("Console").click();
await page.waitForTimeout(400);

// ------------------------------------------------------ before any session

check("with no session open the Console tab offers a console", (await consoleButton.count()) === 1);
check("the port is Automatic until somebody says otherwise", (await portSelect.inputValue()) === "");
check("and the speed is 9600", (await speedSelect.inputValue()) === "9600");
check("nothing has been listed or opened by looking", (await st(() => window.__listed)) === 0 && (await st(() => window.__opened)).length === 0);

// ------------------------------------------------------------- no ports

await consoleButton.click();
await page.waitForTimeout(400);
check("with no serial port it says so, and to plug the cable in", /no serial port/i.test(await message()), await message());
check("and opens nothing", (await st(() => window.__opened)).length === 0);

// --------------------------------------------- ports, but no console cable

await st((ports) => { window.__ports = ports; }, [BUILT_IN]);
await consoleButton.click();
await page.waitForTimeout(400);
check("a built-in port alone is not taken for the cable", /No USB console cable was found/.test(await message()) && (await st(() => window.__opened)).length === 0, await message());
check("but it is offered under Port", (await portSelect.locator("option").allTextContents()).join("|") === "Automatic|ttyS0 — Serial port",
  (await portSelect.locator("option").allTextContents()).join("|"));

// ------------------------------------------------- the one cable, found

await st((ports) => { window.__ports = ports; }, [CABLE, BUILT_IN]);
await consoleButton.click();
await page.waitForTimeout(600);
let opened = await st(() => window.__opened);
check("with one USB serial adapter in, Console opens it without asking",
  opened.length === 1 && opened[0].port === "/dev/ttyUSB0" && opened[0].baud === 9600, JSON.stringify(opened));
check("its tab is on the Console tab, named for the port", (await tabs()).join("|") === "Console ttyUSB0", (await tabs()).join("|"));
check("the status line says what was opened, and that nothing was sent", /Console on ttyUSB0 at 9600 8N1\. Nothing was sent/.test(await message()), await message());
check("nothing was typed at the device by opening it", (await st(() => window.__sent)).length === 0);
check("and no other command that reaches a device was started", (await st(() => window.__other)).length === 0, JSON.stringify(await st(() => window.__other)));

check("the dock's Console tab counts it, and the SSH tab does not",
  /Console \(1\)/.test((await dockTab("Console").textContent()) ?? "") && !/\(/.test((await page.locator(".cv-panel-tabs [role=tab], .cv-panel-tabs button", { hasText: /^SSH/ }).first().textContent()) ?? ""),
  `${await dockTab("Console").textContent()} | ${await page.locator(".cv-panel-tabs [role=tab], .cv-panel-tabs button", { hasText: /^SSH/ }).first().textContent()}`);
check("a console has no keepalive to set", (await page.locator(".cv-ssh-controls", { hasText: "Keepalive" }).count()) === 0);

// What the device says, and what is typed.
await st(() => window.__fromDevice("console-1", "Switch>"));
await page.waitForTimeout(400);
check("what the device says is on the screen", /Switch>/.test((await page.locator(".cv-ssh-screen:not([hidden]) .xterm-rows").textContent()) ?? ""));
await page.locator(".cv-ssh-screen:not([hidden]) .xterm-helper-textarea").focus();
await page.keyboard.type("en");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const sent = await st(() => window.__sent);
check("what is typed goes to the console session, a carriage return for Enter",
  sent.map((s) => s.text).join("") === "en\r" && sent.every((s) => s.id === "console-1"), JSON.stringify(sent));

// A break: only when asked for.
check("no break has been sent", (await st(() => window.__breaks)).length === 0);
await page.locator("button", { hasText: "Send break" }).click();
await page.waitForTimeout(300);
check("Send break sends one, to this session", JSON.stringify(await st(() => window.__breaks)) === '["console-1"]', JSON.stringify(await st(() => window.__breaks)));

// ----------------------------------------- the cable comes out; Enter reopens

await st(() => window.__lost("console-1", "The console on /dev/ttyUSB0 stopped answering: device disconnected"));
await page.waitForTimeout(400);
const ended = (await page.locator(".cv-ssh-screen:not([hidden]) .xterm-rows").textContent()) ?? "";
check("a lost cable is said on the screen, with how to get it back", /stopped answering/.test(ended) && /Press Enter to reconnect/.test(ended), ended.slice(-200));
check("Send break is not offered on an ended session", await page.locator("button", { hasText: "Send break" }).isDisabled());
await page.locator(".cv-ssh-screen:not([hidden]) .xterm-helper-textarea").focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
opened = await st(() => window.__opened);
check("Enter opens the same port at the same speed again, in the same tab",
  opened.length === 2 && opened[1].port === "/dev/ttyUSB0" && opened[1].baud === 9600 && (await tabs()).length === 1, JSON.stringify(opened));

// ------------------------------------------------ two cables: a question

await st((ports) => { window.__ports = ports; }, [CABLE, SECOND, BUILT_IN]);
await consoleButton.click();
await page.waitForTimeout(500);
check("with two adapters in it will not guess", /More than one USB serial adapter/.test(await message()) && (await st(() => window.__opened)).length === 2, await message());
check("both are offered under Port, the adapters first",
  (await portSelect.locator("option").allTextContents()).join("|") === "Automatic|ttyUSB0 — FT232R USB UART (FTDI)|ttyUSB1 — USB serial adapter (Prolific)|ttyS0 — Serial port",
  (await portSelect.locator("option").allTextContents()).join("|"));
await portSelect.selectOption("/dev/ttyUSB1");
await speedSelect.selectOption("115200");
await consoleButton.click();
await page.waitForTimeout(600);
opened = await st(() => window.__opened);
check("the one chosen is opened, at the speed chosen",
  opened.length === 3 && opened[2].port === "/dev/ttyUSB1" && opened[2].baud === 115200, JSON.stringify(opened));
check("a second console is a second tab", (await tabs()).join("|") === "Console ttyUSB0|Console ttyUSB1", (await tabs()).join("|"));
check("the speed is remembered as a setting", (await st(() => window.__settings.consoleBaud)) === "115200", JSON.stringify(await st(() => window.__settings)));

// A port that refuses says why.
await portSelect.selectOption("/dev/ttyS0");
await consoleButton.click();
await page.waitForTimeout(500);
check("a port that will not open says why, as the backend put it", /ttyS0 could not be opened: this account may not use serial ports/.test(await message()), await message());
check("and no tab is made for it", (await tabs()).length === 2);

// ------------------------------------------------- from a device's own menu

await st((ports) => { window.__ports = ports; }, [CABLE]);
await page.locator(".react-flow__node", { hasText: "NEW-SW1" }).first().click({ button: "right" });
await page.waitForTimeout(300);
const item = page.locator(".cv-context-menu button, .cv-menu button", { hasText: "Console to this device" }).first();
check("a device with no address and no login still offers a console", (await item.count()) === 1);
await item.click();
await page.waitForTimeout(600);
opened = await st(() => window.__opened);
check("it opens the cable found, whatever port the panel had picked",
  opened[opened.length - 1].port === "/dev/ttyUSB0", JSON.stringify(opened[opened.length - 1]));
check("and the tab carries the device's name", (await tabs()).includes("NEW-SW1 (console)"), (await tabs()).join("|"));

// Closing a console closes its session.
const before = (await st(() => window.__closed)).length;
await page.locator(".cv-ssh-tab", { hasText: "NEW-SW1 (console)" }).locator(".cv-ssh-close").click();
await page.waitForTimeout(300);
check("closing the tab lets go of the port", (await st(() => window.__closed)).length === before + 1 && !(await tabs()).includes("NEW-SW1 (console)"));
check("through all of it, nothing else that reaches a device was started", (await st(() => window.__other)).length === 0);

// Over on the SSH tab there is still nothing: a console is not a shell.
await page.locator(".cv-panel-tabs [role=tab], .cv-panel-tabs button", { hasText: /^SSH/ }).first().click();
await page.waitForTimeout(400);
check("the SSH tab lists no console session", (await page.locator(".cv-ssh-tab").count()) === 0 && (await page.locator('[data-region="console"]').count()) === 0);
await dockTab("Console").click();
await page.waitForTimeout(400);
check("and back on the Console tab the sessions are as they were, screens and all",
  (await tabs()).length === 2 && /Switch>/.test((await page.locator(".cv-ssh-screen .xterm-rows").first().textContent()) ?? ""), (await tabs()).join("|"));

await browser.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
