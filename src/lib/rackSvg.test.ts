import { describe, expect, it } from 'vitest';

import { rackElevationSvg } from './rackSvg';

describe('rack elevation export', () => {
  const racks = [{ id: 'r', name: 'Rack <A>', units: 4 }];
  const devices = [
    { id: 'sw', label: 'SW & 1', rack: 'Rack <A>', rackUnits: 1, rackU: 4 },
    { id: 'srv', label: 'SRV', rack: 'Rack <A>', rackUnits: 2, rackU: 1, rackFace: 'rear' as const },
    { id: 'pdu', label: 'PDU', rack: 'Rack <A>', rackUnits: 0 },
  ];

  it('draws each rack with its U numbers and the devices on that face', () => {
    const svg = rackElevationSvg(racks, devices, 'front');
    expect(svg).toContain('Rack &lt;A&gt;');
    expect(svg).toContain('SW &amp; 1');
    for (const u of [1, 2, 3, 4]) expect(svg).toContain(`>${u}</text>`);
    expect(svg).toContain('SRV (rear)');
    expect(svg).toContain('url(#behind)');
    expect(svg).toContain('Zero-U: PDU');
  });

  it('draws the rear with the rear-mounted box as seen and the front one behind', () => {
    const svg = rackElevationSvg(racks, devices, 'rear');
    expect(svg).toContain('>SRV</text>');
    expect(svg).toContain('SW &amp; 1 (rear)');
    expect(svg).toContain('4U · rear');
  });

  it('escapes what it writes, so names cannot break the file', () => {
    const svg = rackElevationSvg(racks, devices, 'front');
    // Every < opens a known tag, and every & starts an entity.
    expect(svg.match(/<(?!\/?(svg|defs|pattern|line|rect|text|path|title|circle)\b)/g)).toBeNull();
    expect(svg.match(/&(?!amp;|lt;|gt;|quot;)/g)).toBeNull();
    expect((svg.match(/<text\b/g) ?? []).length).toBe((svg.match(/<\/text>/g) ?? []).length);
  });
});

describe('cables in the export', () => {
  const racks = [{ id: 'r', name: 'R1', units: 6, items: [{ id: 'pdu', kind: 'pdu-vertical' as const, label: 'PDU A', units: 0, face: 'rear' as const, outlets: 8 }] }];
  const devices = [
    { id: 'sw', label: 'SW', rack: 'R1', rackUnits: 1, rackU: 6, kind: 'device' as const, deviceType: 'access-switch', portCount: 24, powerFeeds: [{ pduId: 'pdu', outlet: 2 }] },
    { id: 'fw', label: 'FW', rack: 'R1', rackUnits: 1, rackU: 4, kind: 'device' as const, deviceType: 'firewall', portCount: 8 },
    { id: 'srv', label: 'SRV', rack: 'R2', rackUnits: 1, rackU: 1, kind: 'device' as const },
  ];
  const links = [
    { id: 'e1', source: 'sw', target: 'fw', sourcePortLabel: 'Gi1/0/24', targetPortLabel: 'port1', cableType: 'copper' },
    { id: 'e2', source: 'sw', target: 'srv', sourcePortLabel: 'Gi1/0/1', targetPortLabel: 'eth0' },
  ];

  it('draws the front with port ticks, a cable between two ports, and a stub to another rack', () => {
    const svg = rackElevationSvg(racks, devices, 'front', { links });
    expect(svg).toContain('<title>SW Gi1/0/24 ↔ FW port1</title>');
    expect(svg).toContain('→ SRV, R2');
    expect((svg.match(/<rect [^>]*fill="#6b7a8c"/g) ?? []).length).toBeGreaterThanOrEqual(24 + 8);
  });

  it('draws the rear with the cord from the supply to the PDU outlet', () => {
    const svg = rackElevationSvg(racks, devices, 'rear', { links });
    expect(svg).toContain('<title>SW supply A → PDU A outlet 2</title>');
    expect(svg).not.toContain('SW Gi1/0/24');
  });

  it('draws a zero-U PDU as a bar down the post, named, with a socket per outlet', () => {
    const svg = rackElevationSvg(racks, [...devices.filter((d) => d.id !== 'pdu'), { id: 'pdu', label: 'PDU-A', rack: racks[0]!.name, rackUnits: 0, kind: 'furniture' as const, furniture: 'pdu-vertical' as const, outlets: 6 }], 'front');
    const bar = svg.match(/<rect x="[\d.]+" y="[\d.]+" width="14" height="[\d.]+" fill="#cbd2d9"/g) ?? [];
    expect(bar).toHaveLength(1);
    expect(svg).toMatch(/rotate\(90\)"[^>]*>PDU-A<\/text>/);
    expect((svg.match(/<rect [^>]*width="6" height="4" rx="0.5" fill="#3e4c59"\/>/g) ?? []).length).toBe(6);
  });

  it('draws a zero-U item on the post it is on: right unless it says left', () => {
    const pdu = (side?: 'left' | 'right') => ({ id: 'pdu', label: 'PDU-A', rack: racks[0]!.name, rackUnits: 0, kind: 'furniture' as const, furniture: 'pdu-vertical' as const, outlets: 2, rackSide: side });
    const barX = (svg: string) => Number(/<rect x="([\d.]+)" y="[\d.]+" width="14" height="[\d.]+" fill="#cbd2d9"/.exec(svg)?.[1]);
    const right = barX(rackElevationSvg(racks, [pdu()], 'front'));
    const left = barX(rackElevationSvg(racks, [pdu('left')], 'front'));
    expect(right).toBeGreaterThan(left + 150);
    expect(barX(rackElevationSvg(racks, [pdu('right')], 'front'))).toBe(right);
  });
});
