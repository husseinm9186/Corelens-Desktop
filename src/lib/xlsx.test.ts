import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { unzipStored } from './xlsxReadBack';
import { columnName, crc32, sheetNames, writeXlsx, xmlText, zipStore } from './xlsx';

describe('a workbook written by hand', () => {
  it('computes the checksum every zip reader checks', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('stores files so that they read back whole', () => {
    const enc = new TextEncoder();
    const files = unzipStored(zipStore([
      { path: 'a.txt', bytes: enc.encode('first') },
      { path: 'dir/b é.txt', bytes: enc.encode('second — with a dash') },
    ]));
    expect([...files]).toEqual([['a.txt', 'first'], ['dir/b é.txt', 'second — with a dash']]);
  });

  it('names columns past Z', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('keeps tab names within what a spreadsheet allows', () => {
    expect(sheetNames(['Ports', 'ports', 'a/b:c', '', 'x'.repeat(40)])).toEqual(['Ports', 'ports (2)', 'a b c', 'Sheet4', 'x'.repeat(31)]);
  });

  it('escapes text and drops what XML cannot carry', () => {
    expect(xmlText('a < b & "c"\u0001\u000b')).toBe('a &lt; b &amp; &quot;c&quot;');
  });

  it('has every part a spreadsheet program looks for', () => {
    const files = unzipStored(writeXlsx([
      { name: 'Devices', rows: [['Name', 'Units'], ['SW-1', 2], ['=SUM(A1)', '']] },
      { name: 'Empty', rows: [] },
    ]));
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]);
    const types = files.get('[Content_Types].xml')!;
    for (const part of ['/xl/workbook.xml', '/xl/styles.xml', '/xl/worksheets/sheet1.xml', '/xl/worksheets/sheet2.xml']) expect(types).toContain(`PartName="${part}"`);
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Devices" sheetId="1" r:id="rId1"/>');
    expect(files.get('xl/_rels/workbook.xml.rels')).toContain('Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"');
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    // The header is bold; a number is a number; text is text.
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Name</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>2</v></c>');
    // Something typed like a formula stays the text it was.
    expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">=SUM(A1)</t></is></c>');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('<dimension ref="A1:B3"/>');
    expect(files.get('xl/worksheets/sheet2.xml')).toContain('<sheetData></sheetData>');
  });

  // The application's own workbook reader is tested on this file, so what
  // is written here is known to be read by something other than these tests.
  // UPDATE_XLSX_FIXTURE=1 rewrites it after a deliberate change.
  it('writes the workbook the Rust reader is tested on, byte for byte', () => {
    const fixture = new URL('../../src-tauri/fixtures/workbook/written.xlsx', import.meta.url);
    const bytes = writeXlsx(
      [
        { name: 'Devices', rows: [['Device', 'Rack U', 'Notes'], ['SW-1', 12, 'a < b & "c"'], ['=1+1', 3, 'é — ü']] },
        { name: 'Links', rows: [['From', 'To'], ['SW-1', 'SW-2']] },
        { name: 'Empty', rows: [] },
      ],
      new Date(Date.UTC(2026, 0, 2, 3, 4, 6)),
    );
    if (process.env.UPDATE_XLSX_FIXTURE || !existsSync(fixture)) writeFileSync(fixture, bytes);
    expect(Buffer.from(bytes).equals(readFileSync(fixture))).toBe(true);
  });
});
