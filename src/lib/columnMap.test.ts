import { describe, expect, it } from 'vitest';

import { guessKind, guessMapping, headerRowOf, lowestUnit, mapRows, rackUnitOf, type MappedDevices } from './columnMap';
import { nodesToCsv, parseCsv } from './csv';

describe('column mapping', () => {
  it('guesses an inventory with its own spellings', () => {
    const header = ['Hostname', 'Mgmt IP', 'Manufacturer', 'Serial No', 'Location', 'Comments'];
    expect(guessKind(header)).toBe('devices');
    const m = guessMapping(header, 'devices');
    expect(m).toMatchObject({ name: 0, address: 1, vendor: 2, serial: 3, site: 4, notes: 5, type: null });
  });

  it('keeps a Hostname column apart when there is a Name column', () => {
    // The columns this app's own export writes.
    const header = parseCsv(nodesToCsv([]))[0]!;
    const m = guessMapping(header, 'devices');
    expect(header[m.name!]).toBe('Name');
    expect(header[m.address!]).toBe('IP');
  });

  it('recognises a link list and reads it through the mapping', () => {
    const grid = [['Device A', 'Port A', 'Device B', 'Port B', 'Cable ID'], ['CORE-SW1', 'Gi1/0/1', 'EDGE-RTR1', 'Gi0/0', 'C-0101'], ['', '', '', '', ''], ['CORE-SW1', 'Gi1/0/2', '', '', '']];
    expect(guessKind(grid[0]!)).toBe('links');
    const m = guessMapping(grid[0]!, 'links');
    const r = mapRows(grid, m, 'links');
    expect(r.rows).toEqual([{ source: 'CORE-SW1', target: 'EDGE-RTR1', sourcePort: 'Gi1/0/1', targetPort: 'Gi0/0', label: 'C-0101', healthRule: 'both-endpoints' }]);
    expect(r.errors).toEqual(['Row 4: needs both ends; skipped.']);
  });

  it('reads devices, undoing the formula guard an export adds', () => {
    const grid = [['Inventory, level 2'], ['Name', 'IP', 'Rack', 'Tags'], ["'=SW1", '192.0.2.1', 'R01', 'core; lab'], ['', '192.0.2.2', '', '']];
    const at = headerRowOf(grid);
    expect(at).toBe(1);
    const r = mapRows(grid, guessMapping(grid[at]!, 'devices'), 'devices', at);
    expect(r.kind).toBe('devices');
    expect(r.rows[0]).toMatchObject({ name: '=SW1', address: '192.0.2.1', rack: 'R01', tags: ['core', 'lab'], probeType: 'icmp' });
    expect(r.errors).toEqual(['Row 4: no name; skipped.']);
  });

  it('lets the person override a guess, including leaving a field out', () => {
    const grid = [['Name', 'IP', 'Backup IP'], ['SW1', '192.0.2.1', '198.51.100.1']];
    const m = { ...guessMapping(grid[0]!, 'devices'), address: 2 };
    expect(mapRows(grid, m, 'devices').rows[0]!).toMatchObject({ address: '198.51.100.1' });
    expect(mapRows(grid, { ...m, address: null }, 'devices').rows[0]!).toMatchObject({ address: '' });
  });

  // An inventory as it is often kept: a heading row per site, the devices
  // under it, the top rack unit rather than the lowest, and a column naming
  // the device each one hangs off.
  const inventory = [
    ['Hostname', 'Mgmt IP', 'Model', 'Rack', 'Top RU', 'Height', 'Management device'],
    ['North hall'],
    ['N-CORE-1', '192.0.2.1', 'EX-9000', 'R01', '20', '2', ''],
    ['N-ACC-1', '192.0.2.2', 'EX-48', 'R01', 'U18', '1U', 'N-CORE-1'],
    [''],
    ['South hall'],
    ['S-ACC-1', '192.0.2.3', 'EX-48', 'R07', '1', '4', 'N-CORE-1'],
    ['S-ACC-2', '192.0.2.4', 'EX-48', 'R07', '12', '', ''],
  ];

  it('reads a heading row as the site of the rows under it', () => {
    const m = guessMapping(inventory[0]!, 'devices');
    const r = mapRows(inventory, m, 'devices') as MappedDevices;
    expect(r.headings).toEqual(['North hall', 'South hall']);
    expect(r.rows.map((d) => [d.name, d.site])).toEqual([
      ['N-CORE-1', 'North hall'], ['N-ACC-1', 'North hall'], ['S-ACC-1', 'South hall'], ['S-ACC-2', 'South hall'],
    ]);
  });

  it('keeps a site the row gives for itself over the heading above it', () => {
    const grid = [['Name', 'IP', 'Site'], ['Annex'], ['A-1', '192.0.2.9', 'Main'], ['A-2', '192.0.2.10', '']];
    const r = mapRows(grid, guessMapping(grid[0]!, 'devices'), 'devices');
    expect(r.rows.map((d) => (d as { site?: string }).site)).toEqual(['Main', 'Annex']);
  });

  it('does not take a name-only list for a column of headings', () => {
    const grid = [['Name'], ['SW-1'], ['SW-2']];
    const r = mapRows(grid, guessMapping(grid[0]!, 'devices'), 'devices') as MappedDevices;
    expect(r.headings).toEqual([]);
    expect(r.rows.map((d) => d.name)).toEqual(['SW-1', 'SW-2']);
  });

  it('works the lowest rack unit out from the top one and the height', () => {
    const r = mapRows(inventory, guessMapping(inventory[0]!, 'devices'), 'devices') as MappedDevices;
    // 2U with its top at 20 is in 19 and 20; 1U at 18 is in 18.
    expect(r.rows.map((d) => [d.rackU, d.rackUnits, d.rackTop])).toEqual([
      [19, 2, 20], [18, 1, 18],
      // 4U cannot have its top at 1.
      [undefined, 4, 1],
      // No height in the sheet: the top is kept for whoever knows the height.
      [undefined, undefined, 12],
    ]);
    expect(r.errors).toEqual(['Row 7: 4U with its top at 1 would start below the rack; position left out.']);
  });

  it('prefers the lowest unit when the sheet gives it', () => {
    const grid = [['Name', 'Rack', 'RU', 'Top RU', 'Height'], ['SW-1', 'R1', '5', '9', '2']];
    expect(mapRows(grid, guessMapping(grid[0]!, 'devices'), 'devices').rows[0]).toMatchObject({ rackU: 5, rackUnits: 2 });
  });

  it('carries the device each one connects to', () => {
    const r = mapRows(inventory, guessMapping(inventory[0]!, 'devices'), 'devices') as MappedDevices;
    expect(r.rows.map((d) => d.uplink)).toEqual([undefined, 'N-CORE-1', 'N-CORE-1', undefined]);
  });

  it('reads a rack unit however it is written', () => {
    expect(['12', 'U12', '12U', 'RU 12', ' 3 ', '', 'top', '1-2'].map(rackUnitOf)).toEqual([12, 12, 12, 12, 3, undefined, undefined, undefined]);
    expect([lowestUnit(20, 2), lowestUnit(1, 1), lowestUnit(1, 2), lowestUnit(5, 0)]).toEqual([19, 1, undefined, 5]);
  });
});
