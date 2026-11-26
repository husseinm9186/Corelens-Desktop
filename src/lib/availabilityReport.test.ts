import { describe, expect, it } from 'vitest';

import { availabilityHtml, availabilityModel } from './availabilityReport';
import type { EventRow, HealthStatus } from '../types/domain';

const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);
const min = 60_000;
let n = 0;
const ev = (objectId: string, objectName: string, at: number, from: HealthStatus | null, to: HealthStatus, message = '', target = '192.0.2.10'): EventRow => ({
  id: `e${++n}`, projectId: 'p', sessionId: 's', timestampMs: T0 + at, objectType: 'node', objectId, objectName,
  eventType: 'transition', previousStatus: from, currentStatus: to, probeType: 'tcp', target, rttMs: null, message,
});

const events: EventRow[] = [
  // Three services in one group fail together at +60 min and come back.
  ...['Portal', 'Mail', 'Files'].flatMap((s, i) => [
    ev(s, `PROD · ${s} · app${i}:443`, 0, 'unknown', 'healthy', 'Connected'),
    ev(s, `PROD · ${s} · app${i}:443`, 60 * min + i * 1000, 'healthy', 'down', 'timed out'),
    ev(s, `PROD · ${s} · app${i}:443`, 62 * min + i * 1000, 'down', 'healthy', 'Connected'),
  ]),
  // A device that is slow once.
  ev('sw1', 'CORE-SW1', 0, 'unknown', 'healthy', 'Reply, 2 ms', '192.0.2.1'),
  ev('sw1', 'CORE-SW1', 30 * min, 'healthy', 'warning', 'Reply, 300 ms', '192.0.2.1'),
  ev('sw1', 'CORE-SW1', 31 * min, 'warning', 'healthy', 'Reply, 2 ms', '192.0.2.1'),
  // Down the whole time.
  ev('old', 'OLD-SW', 0, 'unknown', 'down', 'Request timed out', '192.0.2.99'),
  // A target that never resolved.
  ev('mac', 'Some NIC', 0, 'unknown', 'down', 'Host name could not be resolved', '0000.5e00.5301'),
  // Not a transition: ignored.
  { ...ev('sw1', 'CORE-SW1', 5 * min, null, 'healthy'), eventType: 'session' as const },
];
const END = T0 + 120 * min;

describe('availabilityModel', () => {
  const m = availabilityModel(events, END);

  it('groups service checks by the first part of their name, devices last', () => {
    expect(m.groups.map((g) => g.name)).toEqual(['PROD', 'Devices']);
    expect(m.groups[0]!.checks.map((c) => c.label)).toEqual(['Files · app2:443', 'Mail · app1:443', 'Portal · app0:443']);
  });

  it('works out each check’s periods, downtime and availability over its own observed time', () => {
    const portal = m.counted.find((c) => c.id === 'Portal')!;
    expect(portal.periods.map((p) => p.status)).toEqual(['healthy', 'down', 'healthy']);
    expect(portal.downMs).toBe(2 * min);
    expect(portal.availability).toBeCloseTo(100 * (1 - 2 / 120), 5);
    expect(portal.now).toBe('healthy');
    const sw = m.counted.find((c) => c.id === 'sw1')!;
    expect(sw.slowMs).toBe(min);
    expect(sw.availability).toBe(100);
  });

  it('finds the outages that began together as one wide event, back when the last one was', () => {
    expect(m.wide).toHaveLength(1);
    expect(m.wide[0]!.checks).toHaveLength(3);
    expect(m.wide[0]!.fromMs).toBe(T0 + 60 * min);
    expect(m.wide[0]!.toMs).toBe(T0 + 62 * min + 2000);
  });

  it('lists what was down throughout, and sets apart what never ran', () => {
    expect(m.alwaysDown.map((c) => c.name)).toEqual(['OLD-SW']);
    expect(m.neverRan.map((c) => c.name)).toEqual(['Some NIC']);
    expect(m.counted.some((c) => c.name === 'Some NIC')).toBe(false);
    expect(m.fromMs).toBe(T0);
  });

  it('three unrelated outages hours apart are not a wide event', () => {
    const apart = ['A', 'B', 'C'].flatMap((s, i) => [
      ev(s, s, 0, 'unknown', 'healthy'),
      ev(s, s, (10 + i * 30) * min, 'healthy', 'down'),
      ev(s, s, (11 + i * 30) * min, 'down', 'healthy'),
    ]);
    expect(availabilityModel(apart, END).wide).toEqual([]);
  });
});

describe('availabilityHtml', () => {
  const html = availabilityHtml(availabilityModel(events, END), {
    title: 'Availability <test>',
    subtitle: 'Example',
    zone: 'Zulu (UTC)',
    when: (ms) => new Date(ms).toISOString(),
    clock: (ms) => new Date(ms).toISOString().slice(11, 19),
  });

  it('is one self-contained page that fetches nothing', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).toContain('Availability &lt;test&gt;');
  });

  it('carries every part, each check with its timeline and durations', () => {
    for (const part of ['tiles', 'wide', 'always-down', 'availability', 'never-ran']) expect(html).toContain(`data-part="${part}"`);
    expect(html).toContain('data-check="PROD · Portal · app0:443"');
    expect(html).toMatch(/12:00:00[\s\S]*?Down[\s\S]*?2m/);
    expect(html).toContain('98.33%');
    expect(html).toContain('Times in Zulu (UTC)');
  });
});
