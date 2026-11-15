import { describe, expect, it } from 'vitest';

import { parseCsv } from './csv';
import { asBuiltCsv, asBuiltWorkbook, portsCsv, probeResultsCsv, vlansCsv } from './tableCsv';
import { unzipStored } from './xlsxReadBack';
import { emptyDocument } from '../state/store';
import type { TopoEdge, TopoNode } from '../state/store';
import type { Probe } from '../types/domain';

const doc = () => {
  const d = emptyDocument();
  const sw = {
    id: 'sw', type: 'device', position: { x: 0, y: 0 },
    data: {
      label: 'ACCESS-SW7', deviceType: 'access-switch', tags: [], addresses: [],
      inventory: {
        collectedAt: 0, routes: [], spanningTree: [],
        vlans: [{ id: 20, name: 'PRINTERS' }, { id: 10, name: 'STAFF' }],
        ports: [
          { port: 'Gi0/1', status: 'connected', mode: 'trunk', vlan: 1, trunkVlans: '1,10,20', speed: '1000', duplex: 'full', errors: { input: 3, crc: 2, output: 0, collisions: 0, resets: 1, drops: 4 } },
          { port: 'Gi0/2', description: 'desk, 12', status: 'notconnect', mode: 'access', vlan: 10 },
          { port: 'Gi0/3', status: 'connected', mode: 'access', vlan: 10 },
        ],
      },
    },
  } as unknown as TopoNode;
  d.pages[0]!.nodes = [sw];
  d.probes = [{ id: 'p1', objectKind: 'node', objectId: 'sw', name: 'Ping', kind: 'tcp', target: '192.0.2.7', tcpPort: 22, enabled: true } as Probe];
  return d;
};

describe('table CSVs', () => {
  it('lists every port with its counters', () => {
    const rows = parseCsv(portsCsv(doc()));
    expect(rows[0]!.slice(0, 3)).toEqual(['Device', 'Page', 'Port']);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual(['ACCESS-SW7', 'Page 1', 'Gi0/1', '', 'connected', '1000', 'full', 'trunk', '1', '1,10,20', '3', '2', '0', '0', '4', '1']);
    expect(rows[2]![3]).toBe('desk, 12');
  });

  it('lists VLANs in number order with their access ports', () => {
    expect(parseCsv(vlansCsv(doc())).slice(1)).toEqual([
      ['10', 'STAFF', 'ACCESS-SW7', 'Page 1', '2'],
      ['20', 'PRINTERS', 'ACCESS-SW7', 'Page 1', '0'],
    ]);
  });

  it('lists what every probe last found, and its availability over the samples held', () => {
    const runtime = new Map([['p1', { probeId: 'p1', status: 'warning' as const, lastRttMs: 12.5, lastSuccessMs: 86_400_000, lastFailureMs: null, lastSummary: 'slow', consecutiveFailures: 0, failureThreshold: 3 }]]);
    const samples = new Map([['p1', [{ timestampMs: 1, status: 'healthy', rttMs: 1 }, { timestampMs: 2, status: 'down', rttMs: null }]]]);
    const rows = parseCsv(probeResultsCsv(doc(), runtime, samples));
    expect(rows[1]).toEqual(['ACCESS-SW7', 'Ping', 'tcp', '192.0.2.7:22', 'yes', 'warning', '12.5', '1970-01-02T00:00:00.000Z', '', '0', '50', '2', 'slow']);
  });

  it('lists each device once for an as-built, with where it is and what it is cabled to', () => {
    const d = doc();
    const sw = d.pages[0]!.nodes[0]!;
    Object.assign(sw.data, {
      hostname: 'access-sw7.example', role: 'Access', vendor: 'Example', model: 'EX-48', serial: 'SN-0007', assetTag: 'A-7',
      osVersion: '1.2.3', site: 'Site B', rack: 'R2', rackU: 12, rackUnits: 1, notes: 'Floor 2, east',
      stackKind: 'stack', stackMembers: '1: SN-0007\n2: SN-0008',
      addresses: [
        { id: 'a1', label: 'Loopback0', address: '198.51.100.7', isPrimary: false },
        { id: 'a2', label: 'Management', address: '192.0.2.7', isPrimary: true },
      ],
    });
    const core = { id: 'core', type: 'device', position: { x: 0, y: 0 }, data: { label: 'CORE-1', deviceType: 'core-switch', tags: [], addresses: [], site: 'Site A' } } as unknown as TopoNode;
    const zone = { id: 'z', type: 'device', position: { x: 0, y: 0 }, data: { label: 'DMZ', deviceType: 'zone', tags: [], addresses: [] } } as unknown as TopoNode;
    const note = { id: 'n', type: 'note', position: { x: 0, y: 0 }, data: { body: 'x' } } as unknown as TopoNode;
    d.pages[0]!.nodes.push(core, zone, note);
    d.pages[0]!.edges = [
      { id: 'e1', source: 'sw', target: 'core', data: { sourcePortLabel: 'Gi0/1', targetPortLabel: 'Te1/1' } },
      { id: 'e2', source: 'core', target: 'sw', data: { sourcePortLabel: '', targetPortLabel: '' } },
      { id: 'e3', source: 'n', target: 'sw', data: { kind: 'leader' } },
    ] as unknown as TopoEdge[];

    const rows = parseCsv(asBuiltCsv(d));
    expect(rows[0]).toEqual([
      'Device', 'Hostname', 'Type', 'Role', 'Vendor', 'Model', 'Serial number', 'Asset tag',
      'Software', 'Management IP', 'Other addresses', 'MAC address', 'Site', 'Rack', 'Rack U', 'Height (U)',
      'Stack', 'Stack members', 'Ports in use', 'VLANs', 'Connects to', 'Last read', 'Page', 'Notes',
    ]);
    // Site A before Site B; the zone and the note are not devices.
    expect(rows.slice(1).map((r) => r[0])).toEqual(['CORE-1', 'ACCESS-SW7']);
    expect(rows[1]![20]).toBe('Te1/1 to ACCESS-SW7 Gi0/1; ACCESS-SW7');
    expect(rows[2]).toEqual([
      'ACCESS-SW7', 'access-sw7.example', 'access-switch', 'Access', 'Example', 'EX-48', 'SN-0007', 'A-7',
      '1.2.3', '192.0.2.7', 'Loopback0: 198.51.100.7', '', 'Site B', 'R2', '12', '1',
      'stack', '1: SN-0007; 2: SN-0008', '2 of 3', '10,20', 'Gi0/1 to CORE-1 Te1/1; CORE-1', '', 'Page 1', 'Floor 2, east',
    ]);
  });

  it('puts the as-built tables in one workbook, a tab each', () => {
    const d = doc();
    d.pages[0]!.nodes.push({ id: 'c', type: 'device', position: { x: 0, y: 0 }, data: { label: 'CORE-1', deviceType: 'core-switch', tags: [], rackU: 4 } } as unknown as TopoNode);
    d.pages[0]!.edges = [{ id: 'e', source: 'c', target: 'sw', data: { sourcePortLabel: 'Te1/1', targetPortLabel: 'Gi0/1', cableType: 'fiber-mm' } }] as unknown as TopoEdge[];
    const files = unzipStored(asBuiltWorkbook(d));
    const tabs = [...files.get('xl/workbook.xml')!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual(['Devices', 'Links', 'Ports', 'VLANs', 'Addresses']);
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('>ACCESS-SW7<');
    // A rack unit is a number in the sheet, not text that looks like one.
    expect(files.get('xl/worksheets/sheet1.xml')).toMatch(/<c r="O\d+"><v>4<\/v><\/c>/);
    expect(files.get('xl/worksheets/sheet2.xml')).toContain('>Te1/1<');
    expect(files.get('xl/worksheets/sheet2.xml')).toContain('>fiber-mm<');
    expect(files.get('xl/worksheets/sheet3.xml')).toContain('>Gi0/2<');
    expect(files.get('xl/worksheets/sheet4.xml')).toContain('>PRINTERS<');
  });
});
