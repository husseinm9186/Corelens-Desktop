/**
 * The availability report: what every check did over a period, written for
 * someone outside the team to read.
 *
 * Built from the transitions the app already records (see statusHistory.ts):
 * between two transitions nothing changed, so each check's timeline is exact
 * from its first recorded transition to the end of the period. Nothing before
 * that first transition is claimed.
 *
 * What it says, in order:
 *   - tiles: how many checks, up and down at the end, how many had an outage,
 *     how many wide events;
 *   - wide events: three or more checks going down within 90 seconds of one
 *     another, which points at a shared path rather than the services;
 *   - checks down for the whole period;
 *   - a table by group with outages, downtime, availability and state now;
 *   - each check's timeline, newest first, with how long each state lasted;
 *   - checks whose target never resolved, set apart and not counted.
 *
 * A check's group is the first part of its name before " · " (the way
 * service checks are named), and "Devices" otherwise.
 */
import type { EventRow, HealthStatus } from '../types/domain';
import { spanOf } from './dtg';

export interface ReportPeriod {
  status: HealthStatus;
  fromMs: number;
  toMs: number;
  detail: string;
}

export interface ReportCheck {
  id: string;
  name: string;
  group: string;
  label: string;
  probe: string;
  target: string;
  periods: ReportPeriod[];
  downMs: number;
  slowMs: number;
  outages: ReportPeriod[];
  alwaysDown: boolean;
  neverRan: boolean;
  now: HealthStatus;
  /** 0–100: the share of its own observed time it was not down. */
  availability: number;
}

export interface WideEvent {
  fromMs: number;
  /** When the last of them was back up, or the end of the period. */
  toMs: number;
  checks: { name: string; fromMs: number; toMs: number }[];
}

export interface AvailabilityModel {
  fromMs: number;
  toMs: number;
  checks: ReportCheck[];
  counted: ReportCheck[];
  groups: { name: string; checks: ReportCheck[] }[];
  wide: WideEvent[];
  alwaysDown: ReportCheck[];
  neverRan: ReportCheck[];
}

const DEVICES = 'Devices';
const WIDE_WINDOW_MS = 90_000;
const WIDE_MIN = 3;

export function availabilityModel(events: EventRow[], toMs: number): AvailabilityModel {
  const byObject = new Map<string, EventRow[]>();
  for (const e of events) {
    if (e.eventType !== 'transition' || e.currentStatus === null || e.timestampMs > toMs) continue;
    const list = byObject.get(e.objectId);
    if (list) list.push(e);
    else byObject.set(e.objectId, [e]);
  }

  const checks: ReportCheck[] = [];
  for (const [id, list] of byObject) {
    list.sort((a, b) => a.timestampMs - b.timestampMs);
    const periods: ReportPeriod[] = list.map((e, i) => ({
      status: e.currentStatus!,
      fromMs: e.timestampMs,
      toMs: i + 1 < list.length ? list[i + 1]!.timestampMs : toMs,
      detail: e.message,
    }));
    const last = list[list.length - 1]!;
    const name = last.objectName || id;
    const cut = name.indexOf(' · ');
    const observed = toMs - periods[0]!.fromMs;
    const lasting = (s: HealthStatus) => periods.filter((p) => p.status === s).reduce((n, p) => n + (p.toMs - p.fromMs), 0);
    const downMs = lasting('down');
    const alwaysDown = periods.every((p) => p.status === 'down');
    checks.push({
      id,
      name,
      group: cut > 0 ? name.slice(0, cut) : DEVICES,
      label: cut > 0 ? name.slice(cut + 3) : name,
      probe: (last.probeType ?? '').toUpperCase(),
      target: last.target ?? '',
      periods,
      downMs,
      slowMs: lasting('warning'),
      outages: periods.filter((p) => p.status === 'down'),
      alwaysDown,
      neverRan: alwaysDown && periods.some((p) => /could not be resolved/i.test(p.detail)),
      now: last.currentStatus!,
      availability: observed > 0 ? 100 * (1 - downMs / observed) : 100,
    });
  }

  const counted = checks.filter((c) => !c.neverRan);
  const groupNames = [...new Set(counted.map((c) => c.group))].sort((a, b) =>
    a === DEVICES ? 1 : b === DEVICES ? -1 : a.localeCompare(b),
  );
  const groups = groupNames.map((g) => ({
    name: g,
    checks: counted.filter((c) => c.group === g).sort((a, b) => a.label.localeCompare(b.label)),
  }));

  // Outages that began close together, among checks that were ever up.
  const starts = counted
    .filter((c) => !c.alwaysDown)
    .flatMap((c) => c.outages.map((o) => ({ name: c.name, fromMs: o.fromMs, toMs: o.toMs })))
    .sort((a, b) => a.fromMs - b.fromMs);
  const wide: WideEvent[] = [];
  let run: WideEvent | null = null;
  for (const s of starts) {
    if (run && s.fromMs - run.checks[run.checks.length - 1]!.fromMs <= WIDE_WINDOW_MS) {
      run.checks.push(s);
      run.toMs = Math.max(run.toMs, s.toMs);
    } else {
      if (run && run.checks.length >= WIDE_MIN) wide.push(run);
      run = { fromMs: s.fromMs, toMs: s.toMs, checks: [s] };
    }
  }
  if (run && run.checks.length >= WIDE_MIN) wide.push(run);

  const firsts = counted.map((c) => c.periods[0]!.fromMs);
  return {
    fromMs: firsts.length ? Math.min(...firsts) : toMs,
    toMs,
    checks,
    counted,
    groups,
    wide,
    alwaysDown: counted.filter((c) => c.alwaysDown),
    neverRan: checks.filter((c) => c.neverRan),
  };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const WORD: Partial<Record<HealthStatus, string>> = { healthy: 'Up', down: 'Down', warning: 'Slow', unknown: 'Not checked', disabled: 'Disabled', maintenance: 'Maintenance' };
const TONE: Partial<Record<HealthStatus, string>> = { healthy: 'up', down: 'down', warning: 'slow' };
const badge = (s: HealthStatus) => `<span class="st ${TONE[s] ?? 'none'}">${WORD[s] ?? s}</span>`;
const pct = (c: ReportCheck) =>
  `<span class="st ${c.availability >= 99.9 ? 'up' : c.availability >= 99 ? 'slow' : 'down'}">${c.availability.toFixed(2)}%</span>`;

export interface ReportText {
  title: string;
  subtitle: string;
  /** "CST (UTC−06:00)" or "Zulu (UTC)". */
  zone: string;
  /** An instant written the operator's way, with and without the date. */
  when: (ms: number) => string;
  clock: (ms: number) => string;
}

/** The report as one self-contained HTML page, laid out for paper too. */
export function availabilityHtml(m: AvailabilityModel, t: ReportText): string {
  const upNow = m.counted.filter((c) => c.now === 'healthy').length;
  const downNow = m.counted.filter((c) => c.now === 'down').length;
  const hadOutage = m.counted.filter((c) => c.outages.length > 0 && !c.alwaysDown).length;
  const slow = m.counted.filter((c) => c.slowMs > 0).length;
  const out: string[] = [];
  out.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(t.title)}</title><style>
:root{--ink:#1b2430;--dim:#5b6673;--line:#dde2e8;--band:#f4f6f9;--up:#1a7f43;--down:#c4302b;--slow:#b26a00;--none:#6b7480}
*{box-sizing:border-box}body{font:13px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:#fff;margin:0}
main{max-width:980px;margin:0 auto;padding:32px 24px 48px}h1{font-size:24px;margin:0 0 4px}
h2{font-size:17px;margin:32px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--ink)}h3{font-size:14px;margin:22px 0 6px}
.sub,.note{color:var(--dim)}.note{font-size:12px}.sub{margin:0 0 18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}
.tile{border:1px solid var(--line);border-radius:8px;padding:10px 12px}.tile b{display:block;font-size:22px}.tile span{color:var(--dim);font-size:12px}
table{width:100%;border-collapse:collapse;margin:6px 0 4px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--dim);font-weight:600}.num{text-align:right;white-space:nowrap}
.mono{font-family:"SF Mono",Consolas,"Liberation Mono",monospace;font-size:12px;white-space:nowrap}
.st{font-weight:600}.st.up{color:var(--up)}.st.down{color:var(--down)}.st.slow{color:var(--slow)}.st.none{color:var(--none)}
.check{border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin:10px 0;break-inside:avoid}
.check header{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}.check header span{color:var(--dim);font-size:12px}
.check td{border-bottom:1px solid var(--band)}.check td:last-child{text-align:right;color:var(--dim)}
.bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--band);margin:6px 0 2px}.bar i{display:block;height:100%}
.bar .up{background:var(--up)}.bar .down{background:var(--down)}.bar .slow{background:var(--slow)}.bar .none{background:#c9ced5}
@media print{main{padding:0;max-width:none}h2{break-after:avoid}.pb{break-before:page}}@page{size:Letter;margin:14mm 12mm}
</style></head><body><main>`);
  out.push(`<h1>${esc(t.title)}</h1><p class="sub">${esc(t.subtitle)}<br>Period: ${esc(t.when(m.fromMs))} to ${esc(t.when(m.toMs))} · ${spanOf(m.fromMs, m.toMs)} · Times in ${esc(t.zone)}</p>`);
  out.push(`<div class="tiles" data-part="tiles">
<div class="tile"><b>${m.counted.length}</b><span>checks reported</span></div>
<div class="tile"><b class="st up">${upNow}</b><span>up at the end of the period</span></div>
<div class="tile"><b class="st down">${downNow}</b><span>down at the end of the period</span></div>
<div class="tile"><b>${hadOutage}</b><span>had at least one outage</span></div>
<div class="tile"><b>${m.wide.length}</b><span>wide events (${WIDE_MIN}+ checks at once)</span></div></div>`);

  out.push('<h2>Summary</h2><ul>');
  for (const w of m.wide) {
    out.push(`<li><b>${esc(t.clock(w.fromMs))}</b>: ${w.checks.length} checks went down together and were all back by <b>${esc(t.clock(w.toMs))}</b> (${spanOf(w.fromMs, w.toMs)}).</li>`);
  }
  if (m.wide.length) out.push('<li>When many services fail at the same moment and recover together, the cause is usually a shared network path between the monitoring workstation and the services, not the services themselves.</li>');
  if (m.alwaysDown.length) out.push(`<li>${m.alwaysDown.length} checks were down for the whole period; they are listed under <i>Down for the whole period</i>.</li>`);
  if (slow) out.push(`<li>${slow} checks had short periods of slow responses (answering, but above the warning latency).</li>`);
  out.push(`<li>${m.wide.length || m.alwaysDown.length || hadOutage ? 'Every other check was up for the whole period.' : 'Every check was up for the whole period.'}</li></ul>`);

  if (m.wide.length) {
    out.push('<h2>Wide events</h2>');
    for (const w of m.wide) {
      out.push(`<h3>${esc(t.when(w.fromMs))} · ${w.checks.length} checks · ${spanOf(w.fromMs, w.toMs)}</h3><table data-part="wide"><tr><th>Check</th><th class="num">Down</th><th class="num">Back up</th><th class="num">Duration</th></tr>`);
      for (const c of w.checks) {
        out.push(`<tr><td>${esc(c.name)}</td><td class="num mono">${esc(t.clock(c.fromMs))}</td><td class="num mono">${c.toMs < m.toMs ? esc(t.clock(c.toMs)) : 'still down'}</td><td class="num mono">${spanOf(c.fromMs, c.toMs)}</td></tr>`);
      }
      out.push('</table>');
    }
  }

  if (m.alwaysDown.length) {
    out.push(`<h2>Down for the whole period</h2><p class="note">These did not answer at any point in the period: retired, moved, powered off, or not reachable from the monitoring workstation. Worth confirming which of these are expected.</p><table data-part="always-down"><tr><th>Check</th><th>Target</th><th>Last result</th></tr>`);
    for (const c of [...m.alwaysDown].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`<tr><td>${esc(c.name)}</td><td class="mono">${esc(c.target)} <span class="note">${esc(c.probe)}</span></td><td class="note">${esc(c.periods[c.periods.length - 1]!.detail)}</td></tr>`);
    }
    out.push('</table>');
  }

  out.push('<h2 class="pb">Availability by check</h2><table data-part="availability"><tr><th>Check</th><th>Target</th><th class="num">Outages</th><th class="num">Downtime</th><th class="num">Availability</th><th class="num">Now</th></tr>');
  for (const g of m.groups) {
    out.push(`<tr><th colspan="6" style="padding-top:14px;color:var(--ink)">${esc(g.name)}</th></tr>`);
    for (const c of g.checks) {
      out.push(`<tr><td>${esc(c.label)}</td><td class="mono">${esc(c.target)} <span class="note">${esc(c.probe)}</span></td><td class="num">${c.outages.length}</td><td class="num mono">${c.downMs ? spanOf(0, c.downMs) : '—'}</td><td class="num">${pct(c)}</td><td class="num">${badge(c.now)}</td></tr>`);
    }
  }
  out.push('</table><p class="note">Availability is the share of the period the check was not down, from the moment it was first checked. Slow periods count as up.</p>');

  out.push('<h2 class="pb">Timeline of each check</h2><p class="note">Each row is a change of state and how long that state lasted, newest first.</p>');
  for (const g of m.groups) {
    out.push(`<h3>${esc(g.name)}</h3>`);
    for (const c of g.checks) {
      const span = Math.max(1, m.toMs - c.periods[0]!.fromMs);
      const bar = c.periods.map((p) => `<i class="${TONE[p.status] ?? 'none'}" style="width:${((100 * (p.toMs - p.fromMs)) / span).toFixed(3)}%"></i>`).join('');
      out.push(`<div class="check" data-check="${esc(c.name)}"><header><b>${esc(c.label)}</b><span>${esc(c.probe)} ${esc(c.target)} · ${pct(c)}</span></header><div class="bar">${bar}</div><table>`);
      for (const p of [...c.periods].reverse()) {
        out.push(`<tr><td class="mono">${esc(t.when(p.fromMs))}</td><td>${badge(p.status)}</td><td class="note">${esc(p.detail)}</td><td class="mono">${spanOf(p.fromMs, p.toMs)}</td></tr>`);
      }
      out.push('</table></div>');
    }
  }

  if (m.neverRan.length) {
    out.push('<h2 class="pb">Checks that could not run</h2><p class="note">Their target could not be resolved, so they say nothing about the service. Not counted above.</p><table data-part="never-ran"><tr><th>Check</th><th>Target</th><th>Reason</th></tr>');
    for (const c of m.neverRan) {
      out.push(`<tr><td>${esc(c.name)}</td><td class="mono">${esc(c.target)}</td><td class="note">${esc(c.periods[c.periods.length - 1]!.detail)}</td></tr>`);
    }
    out.push('</table>');
  }
  out.push(`<p class="note" style="margin-top:32px">Checks run from the monitoring workstation; a check that is down means it could not be reached from there. Generated ${esc(t.when(m.toMs))} ${esc(t.zone)}.</p></main></body></html>`);
  return out.join('');
}
