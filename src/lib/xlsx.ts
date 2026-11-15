/**
 * A workbook written by hand: several tables in one .xlsx.
 *
 * An .xlsx is a zip of small XML parts. Nothing here compresses — the parts
 * are stored as they are, which every spreadsheet program reads and which
 * needs no library — and text is written inline in its cell rather than
 * through a shared-strings part. A cell holding text is typed as text, so a
 * value beginning with `=` is shown as typed and never evaluated.
 */

export interface WorkbookSheet {
  name: string;
  /** The header first, then a row per record. */
  rows: readonly (readonly unknown[])[];
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Files as a zip archive, stored without compression. */
export function zipStore(files: readonly { path: string; bytes: Uint8Array }[], when = new Date()): Uint8Array {
  const enc = new TextEncoder();
  // In UTC, so the same contents at the same instant are the same bytes
  // wherever they are written.
  const time = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1);
  const date = ((Math.max(1980, when.getUTCFullYear()) - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate();
  const names = files.map((f) => enc.encode(f.path));
  const bodySize = files.reduce((n, f, i) => n + 30 + names[i]!.length + f.bytes.length, 0);
  const dirSize = files.reduce((n, _f, i) => n + 46 + names[i]!.length, 0);
  const out = new Uint8Array(bodySize + dirSize + 22);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  const crcs: number[] = [];
  let at = 0;
  files.forEach((f, i) => {
    const name = names[i]!;
    const crc = crc32(f.bytes);
    offsets.push(at);
    crcs.push(crc);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 0x0800, true); // names are UTF-8
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, time, true);
    view.setUint16(at + 12, date, true);
    view.setUint32(at + 14, crc, true);
    view.setUint32(at + 18, f.bytes.length, true);
    view.setUint32(at + 22, f.bytes.length, true);
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(name, at + 30);
    out.set(f.bytes, at + 30 + name.length);
    at += 30 + name.length + f.bytes.length;
  });
  const dirStart = at;
  files.forEach((f, i) => {
    const name = names[i]!;
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, time, true);
    view.setUint16(at + 14, date, true);
    view.setUint32(at + 16, crcs[i]!, true);
    view.setUint32(at + 20, f.bytes.length, true);
    view.setUint32(at + 24, f.bytes.length, true);
    view.setUint16(at + 28, name.length, true);
    // extra, comment, disk, internal and external attributes: all zero
    view.setUint32(at + 42, offsets[i]!, true);
    out.set(name, at + 46);
    at += 46 + name.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, files.length, true);
  view.setUint16(at + 10, files.length, true);
  view.setUint32(at + 12, at - dirStart, true);
  view.setUint32(at + 16, dirStart, true);
  return out;
}

/** Text as XML character data: the five entities, and none of the control
 *  characters XML 1.0 has no way to carry. */
export function xmlText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `0` → `A`, `26` → `AA`. */
export function columnName(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Tab names as a spreadsheet allows them: 31 characters, none of
 *  `[ ] : * ? / \`, and no two the same. */
export function sheetNames(wanted: readonly string[]): string[] {
  const taken = new Set<string>();
  return wanted.map((raw, i) => {
    const base = raw.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    taken.add(name.toLowerCase());
    return name;
  });
}

const textOf = (v: unknown): string => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v));

function sheetXml(rows: readonly (readonly unknown[])[]): string {
  const columns = rows.reduce((m, r) => Math.max(m, r.length), 0);
  // Wide enough for what is in it, within reason: a notes column does not
  // push every other one off the screen.
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.min(60, Math.max(8, ...rows.slice(0, 500).map((r) => textOf(r[c]).length + 2))),
  );
  const body = rows
    .map((r, y) => {
      const cells = r
        .map((v, x) => {
          const ref = `${columnName(x)}${y + 1}`;
          const style = y === 0 ? ' s="1"' : '';
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
          const text = textOf(v);
          if (!text) return '';
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
        })
        .join('');
      return `<row r="${y + 1}">${cells}</row>`;
    })
    .join('');
  const last = `${columnName(Math.max(0, columns - 1))}${Math.max(1, rows.length)}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${last}"/>` +
    // The header stays in view while the rows scroll under it.
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    (columns ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '') +
    `<sheetData>${body}</sheetData>` +
    (columns && rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : '') +
    '</worksheet>'
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** The sheets as one .xlsx: a tab each, the first row bold and frozen. */
export function writeXlsx(sheets: readonly WorkbookSheet[], when = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const names = sheetNames(sheets.map((s) => s.name));
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [
    {
      path: '[Content_Types].xml',
      text:
        `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>',
    },
    {
      path: '_rels/.rels',
      text:
        `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      path: 'xl/workbook.xml',
      text:
        `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        '</workbook>',
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      text:
        `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    { path: 'xl/styles.xml', text: STYLES },
    ...sheets.map((s, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s.rows) })),
  ];
  return zipStore(files.map((f) => ({ path: f.path, bytes: enc.encode(f.text) })), when);
}
