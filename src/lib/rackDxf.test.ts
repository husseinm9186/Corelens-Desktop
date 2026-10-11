import { describe, expect, it } from 'vitest';

import { OPENING_MM, U_MM, rackElevationDxf } from './rackDxf';

describe('the DXF export', () => {
  const racks = [{ id: 'r', name: 'R1', units: 6, widthMm: 600, building: 'HQ', room: 'MDF', revision: 'B' }];
  const devices = [
    { id: 'sw', label: 'SW-1', rack: 'R1', rackUnits: 1, rackU: 6, kind: 'device' as const, deviceType: 'access-switch', portCount: 24 },
    { id: 'fw', label: 'FW', rack: 'R1', rackUnits: 2, rackU: 3, kind: 'device' as const, deviceType: 'firewall', portCount: 8, rackFace: 'rear' as const },
  ];
  const links = [{ id: 'e1', source: 'sw', target: 'fw', sourcePortLabel: 'Gi1/0/1', targetPortLabel: 'port1' }];

  it('is an R12 file with the six layers, in millimetres, ending in EOF', () => {
    const dxf = rackElevationDxf(racks, devices, 'front', { project: 'P', links, date: new Date('2026-10-03T00:00:00Z') });
    expect(dxf.startsWith('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009')).toBe(true);
    expect(dxf).toContain('9\n$INSUNITS\n70\n4');
    for (const layer of ['RACK', 'U', 'ITEMS', 'LABELS', 'CABLES', 'TITLE']) expect(dxf).toContain(`0\nLAYER\n2\n${layer}`);
    expect(dxf.trimEnd().endsWith('0\nEOF')).toBe(true);
  });

  it('draws the units at 44.45 mm each, numbers them, and puts each box where it is', () => {
    const dxf = rackElevationDxf(racks, devices, 'front', {});
    // Six unit lines at y = 50 + (u-1) * U_MM, and the top edge.
    for (let u = 1; u <= 6; u++) expect(dxf).toContain(`20\n${Math.round((50 + (u - 1) * U_MM) * 100) / 100}`);
    expect(dxf).toContain('1\n6\n'); // the number 6 on the rail
    expect(dxf).toContain('1\nSW-1 [access-switch]');
    // The firewall is mounted on the rear, so from the front it is behind: crossed.
    expect(dxf).toContain('1\nFW [firewall] (rear)');
    expect(dxf).toContain(`${OPENING_MM}`);
  });

  it('numbers from the top when the rack says so', () => {
    const dxf = rackElevationDxf([{ ...racks[0]!, numbering: 'top' }], devices, 'front', {});
    // The lowest unit's label is 6 and the highest's is 1: the first TEXT on the U layer says 6.
    const first = dxf.indexOf('8\nU\n10');
    const firstText = dxf.indexOf('0\nTEXT\n8\nU', first);
    expect(dxf.slice(firstText, firstText + 120)).toMatch(/1\n6\n/);
  });

  it('draws a cable between the ports a link names, and the title block with project, racks, place, date and revision', () => {
    const dxf = rackElevationDxf(racks, devices, 'rear', { project: 'Branch 12', revision: 'B', links, date: new Date('2026-10-03T00:00:00Z') });
    expect(dxf).toContain('1\nBranch 12');
    expect(dxf).toContain('1\nR1\n');
    expect(dxf).toContain('1\nHQ · Room MDF');
    expect(dxf).toContain('2026-10-03 · rev B · Corelens');
    const front = rackElevationDxf(racks, devices, 'front', { links });
    expect((front.match(/8\nCABLES\n/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('draws a zero-U PDU as a bar beside the opening, named, with its outlets', () => {
    const pdu = { id: 'pdu', label: 'PDU-A', rack: 'R1', rackUnits: 0, kind: 'furniture' as const, furniture: 'pdu-vertical' as const, outlets: 4 };
    const dxf = rackElevationDxf(racks, [...devices, pdu], 'front', {});
    expect(dxf).toContain('1\nPDU-A');
    // The bar: 30 mm wide, the rack's height, to the right of the opening; and four sockets 10 by 6.
    // A rectangle is four LINE entities: one bar and four sockets.
    const lines = (d: string) => d.split('0\nLINE').length - 1;
    expect(lines(dxf) - lines(rackElevationDxf(racks, devices, 'front', {}))).toBe((1 + 4) * 4);
    expect(rackElevationDxf(racks, [...devices, pdu], 'rear', {})).not.toContain('1\nPDU-A');
  });

  it('puts a left-post zero-U item to the left of the opening', () => {
    const pdu = (side?: 'left' | 'right') => ({ id: 'pdu', label: 'PDU-A', rack: 'R1', rackUnits: 0, kind: 'furniture' as const, furniture: 'pdu-vertical' as const, outlets: 1, rackSide: side });
    const barX = (dxf: string) => {
      // The label is written at the bar's left edge plus 2.
      const i = dxf.indexOf('1\nPDU-A');
      const before = dxf.slice(0, i);
      return Number(/10\n(-?[\d.]+)\n20\n[\d.]+\n30\n0\n40\n8\n$/.exec(before)?.[1]) - 2;
    };
    const right = barX(rackElevationDxf(racks, [...devices, pdu()], 'front', {}));
    const left = barX(rackElevationDxf(racks, [...devices, pdu('left')], 'front', {}));
    expect(right).toBeGreaterThan(OPENING_MM);
    expect(left).toBeLessThan(60);
  });
});
