/**
 * Which spreadsheet column is which.
 *
 * Every inventory names its columns differently — `Hostname`, `Device`,
 * `Mgmt IP`, `Serial No` — and the CSV importer used to accept only its own
 * spellings. This guesses a mapping from the header, shows it, and lets the
 * person correct it before anything is added. The same mapping reads a CSV
 * and every sheet of a workbook, because both arrive here as a grid of text.
 */
import type { LinkCsvRow, NodeCsvRow } from './csv';
import type { LinkHealthRuleType, ProbeKind } from '../types/domain';

export type ImportKind = 'devices' | 'links';

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  /** Header spellings, normalised (lower case, no spaces, dashes or
   *  underscores), best first. */
  aliases: string[];
}

export const DEVICE_FIELDS: ImportField[] = [
  { key: 'name', label: 'Name', required: true, aliases: ['name', 'devicename', 'device', 'hostname', 'host', 'label'] },
  { key: 'address', label: 'Address', aliases: ['ip', 'ipaddress', 'mgmtip', 'managementip', 'managementaddress', 'primaryip', 'primaryipv4', 'address', 'iphostname', 'hostname', 'fqdn'] },
  { key: 'type', label: 'Type', aliases: ['type', 'devicetype', 'kind', 'shape', 'class'] },
  { key: 'role', label: 'Role', aliases: ['role', 'devicerole', 'function'] },
  { key: 'vendor', label: 'Vendor', aliases: ['vendor', 'manufacturer', 'make', 'brand'] },
  { key: 'model', label: 'Model', aliases: ['model', 'platform', 'hardware', 'modelnumber', 'pid'] },
  { key: 'serial', label: 'Serial number', aliases: ['serialnumber', 'serial', 'serialno', 'sn', 's/n'] },
  { key: 'assetTag', label: 'Asset tag', aliases: ['assettag', 'asset', 'assetno', 'assetnumber'] },
  { key: 'site', label: 'Site', aliases: ['site', 'location', 'building', 'campus'] },
  { key: 'rack', label: 'Rack', aliases: ['rack', 'cabinet', 'rackname', 'racknumber'] },
  { key: 'rackU', label: 'Lowest rack unit', aliases: ['racku', 'rackunit', 'ru', 'u', 'bottomru', 'bottomu', 'lowestu', 'startu', 'rackposition', 'position', 'uposition'] },
  { key: 'rackTop', label: 'Top rack unit', aliases: ['topru', 'topu', 'toprackunit', 'topunit', 'rutop', 'utop', 'topposition'] },
  { key: 'rackUnits', label: 'Height (U)', aliases: ['heightu', 'height', 'uheight', 'rackunits', 'rusize', 'usize', 'units', 'size', 'ruheight'] },
  { key: 'uplink', label: 'Connects to', aliases: ['connectsto', 'connectedto', 'uplink', 'uplinkdevice', 'uplinkto', 'managementdevice', 'mgmtdevice', 'managedby', 'upstream', 'upstreamdevice', 'parent', 'parentdevice'] },
  { key: 'tags', label: 'Tags', aliases: ['tags', 'tag', 'labels', 'groups'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments', 'comment', 'description'] },
  { key: 'probeType', label: 'Probe type', aliases: ['probetype', 'check', 'checktype'] },
  { key: 'port', label: 'Probe port', aliases: ['port', 'tcpport', 'probeport'] },
];

export const LINK_FIELDS: ImportField[] = [
  { key: 'source', label: 'Source device', required: true, aliases: ['sourcename', 'source', 'from', 'adevice', 'devicea', 'sidea', 'local', 'localdevice'] },
  { key: 'target', label: 'Target device', required: true, aliases: ['targetname', 'target', 'to', 'bdevice', 'deviceb', 'sideb', 'remote', 'remotedevice', 'neighbour', 'neighbor'] },
  { key: 'sourcePort', label: 'Source port', aliases: ['sourceport', 'fromport', 'aport', 'porta', 'localport', 'localinterface', 'interface'] },
  { key: 'targetPort', label: 'Target port', aliases: ['targetport', 'toport', 'bport', 'portb', 'remoteport', 'remoteinterface'] },
  { key: 'label', label: 'Label', aliases: ['linklabel', 'label', 'cable', 'cableid', 'circuit', 'description'] },
  { key: 'healthRule', label: 'Health rule', aliases: ['healthrule', 'rule'] },
];

export type ColumnMapping = Record<string, number | null>;

export const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/[\s_-]/g, '');

export function fieldsFor(kind: ImportKind): ImportField[] {
  return kind === 'devices' ? DEVICE_FIELDS : LINK_FIELDS;
}

/** Links when the header plainly has two ends; devices otherwise. */
export function guessKind(header: readonly string[]): ImportKind {
  const m = guessMapping(header, 'links');
  return m.source !== null && m.target !== null ? 'links' : 'devices';
}

/** Each field to the first column whose header is one of its spellings, in
 *  field order, never using a column twice. */
export function guessMapping(header: readonly string[], kind: ImportKind): ColumnMapping {
  const norm = header.map(normaliseHeader);
  const used = new Set<number>();
  const out: ColumnMapping = {};
  for (const f of fieldsFor(kind)) {
    out[f.key] = null;
    for (const alias of f.aliases) {
      const i = norm.findIndex((h, at) => h === alias && !used.has(at));
      if (i >= 0) {
        out[f.key] = i;
        used.add(i);
        break;
      }
    }
  }
  return out;
}

/** A cell as typed, with the quote a spreadsheet export adds in front of a
 *  formula character taken back off. */
function cell(row: readonly string[], i: number | null | undefined): string {
  if (i === null || i === undefined) return '';
  const v = (row[i] ?? '').trim();
  return /^'[=+\-@]/.test(v) ? v.slice(1) : v;
}

const HEALTH_RULES: LinkHealthRuleType[] = ['manual', 'follow-source', 'follow-target', 'both-endpoints', 'dedicated-probe', 'named-node-probe'];

export interface MappedDevices {
  kind: 'devices';
  rows: NodeCsvRow[];
  errors: string[];
  /** The heading rows found between the devices, in order: each names the
   *  site of the rows under it. */
  headings: string[];
}

/** A rack unit as people write one: `12`, `U12`, `12U`, `RU 12`. */
export function rackUnitOf(text: string): number | undefined {
  const m = /^\s*(?:r?u\s*)?(\d{1,3})\s*(?:r?u)?\s*$/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 0 && n <= 200 ? n : undefined;
}

/**
 * The lowest unit a device occupies, from the top one and its height.
 * Rack units count up from the bottom, so a 2U device whose top is at 20
 * sits in 19 and 20. Undefined when that would put it below the rack.
 */
export function lowestUnit(top: number, height: number): number | undefined {
  const lowest = top - Math.max(1, height) + 1;
  return lowest >= 1 ? lowest : undefined;
}
export interface MappedLinks {
  kind: 'links';
  rows: LinkCsvRow[];
  errors: string[];
}

/** The rows under the header, read through the mapping. Row numbers in the
 *  errors are the spreadsheet's own (the header is row `headerRow + 1`). */
export function mapRows(grid: readonly (readonly string[])[], mapping: ColumnMapping, kind: ImportKind, headerRow = 0): MappedDevices | MappedLinks {
  const errors: string[] = [];
  const body = grid.slice(headerRow + 1);
  const rowNo = (i: number) => headerRow + i + 2;
  const blank = (r: readonly string[]) => r.every((c) => !c.trim());
  if (kind === 'devices') {
    const rows: NodeCsvRow[] = [];
    const headings: string[] = [];
    // A row with one cell in it, in a sheet whose devices have several, is
    // a heading over the rows that follow — "Building A", then its devices —
    // and names their site wherever the sheet gives them none of their own.
    const mapped = Object.values(mapping).filter((v) => v !== null && v !== undefined).length;
    const filled = (r: readonly string[]) => r.filter((c) => c.trim()).length;
    const isHeading = (r: readonly string[], i: number) => {
      if (mapped < 2 || filled(r) !== 1) return false;
      const next = body.slice(i + 1).find((x) => !blank(x));
      return next !== undefined && filled(next) >= 2;
    };
    let site: string | undefined;
    body.forEach((r, i) => {
      if (blank(r)) return;
      if (isHeading(r, i)) {
        site = r.find((c) => c.trim())!.trim();
        headings.push(site);
        return;
      }
      const name = cell(r, mapping.name);
      if (!name) {
        errors.push(`Row ${rowNo(i)}: no name; skipped.`);
        return;
      }
      const kindText = cell(r, mapping.probeType).toLowerCase();
      const optional = (key: string) => cell(r, mapping[key]) || undefined;
      rows.push({
        name,
        type: cell(r, mapping.type) || 'generic',
        address: cell(r, mapping.address),
        probeType: (['icmp', 'tcp', 'dns', 'manual'].includes(kindText) ? kindText : 'icmp') as ProbeKind,
        port: Number(cell(r, mapping.port)) || undefined,
        notes: cell(r, mapping.notes),
        tags: cell(r, mapping.tags).split(/[;|]/).map((t) => t.trim()).filter(Boolean),
        vendor: optional('vendor'),
        model: optional('model'),
        serial: optional('serial'),
        assetTag: optional('assetTag'),
        role: optional('role'),
        site: optional('site') ?? site,
        rack: optional('rack'),
        ...((): Partial<NodeCsvRow> => {
          const height = rackUnitOf(cell(r, mapping.rackUnits));
          const lowest = rackUnitOf(cell(r, mapping.rackU));
          const top = rackUnitOf(cell(r, mapping.rackTop));
          const out: Partial<NodeCsvRow> = {};
          if (height !== undefined) out.rackUnits = height;
          // The lowest unit as given wins; a top unit is kept as it is, and
          // turned into the lowest where the height is known.
          if (lowest !== undefined && lowest >= 1) out.rackU = lowest;
          else if (top !== undefined && top >= 1) {
            out.rackTop = top;
            if (height !== undefined) {
              const from = lowestUnit(top, height);
              if (from === undefined) errors.push(`Row ${rowNo(i)}: ${height}U with its top at ${top} would start below the rack; position left out.`);
              else out.rackU = from;
            }
          }
          return out;
        })(),
        uplink: optional('uplink'),
      });
    });
    return { kind, rows, errors, headings };
  }
  const rows: LinkCsvRow[] = [];
  body.forEach((r, i) => {
    if (blank(r)) return;
    const source = cell(r, mapping.source);
    const target = cell(r, mapping.target);
    if (!source || !target) {
      errors.push(`Row ${rowNo(i)}: needs both ends; skipped.`);
      return;
    }
    const rule = cell(r, mapping.healthRule) as LinkHealthRuleType;
    rows.push({
      source,
      target,
      sourcePort: cell(r, mapping.sourcePort),
      targetPort: cell(r, mapping.targetPort),
      label: cell(r, mapping.label),
      healthRule: HEALTH_RULES.includes(rule) ? rule : 'both-endpoints',
    });
  });
  return { kind, rows, errors };
}

/** The first row that looks like a header: the first with at least two
 *  non-empty cells, so a title line above the table is passed over. */
export function headerRowOf(grid: readonly (readonly string[])[]): number {
  const i = grid.findIndex((r) => r.filter((c) => c.trim()).length >= 2);
  return i < 0 ? 0 : i;
}
