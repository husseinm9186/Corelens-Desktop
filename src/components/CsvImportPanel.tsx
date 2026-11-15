import { useMemo, useState } from 'react';

import { useStore, type TopoEdge } from '../state/store';
import { ipc, isDesktop } from '../lib/ipc';
import { parseCsv, type LinkCsvRow, type NodeCsvRow } from '../lib/csv';
import { fieldsFor, guessKind, guessMapping, headerRowOf, lowestUnit, mapRows, type ColumnMapping, type ImportKind } from '../lib/columnMap';
import { placeBySite } from '../lib/importLayout';
import { frameAround, withBoxAtBack } from '../lib/groupBox';
import { readNetbox, type NetboxImport } from '../lib/netbox';
import { makeDeviceNode } from './Canvas';
import { newProbe } from '../lib/probes';
import { uid } from '../lib/id';
import { DEVICE_LABEL } from './icons';
import type { DeviceNodeData, DeviceType, LinkData } from '../types/domain';
import { activePage, withPage } from '../lib/pages';
import { t } from '../i18n';

/** Matches a `type` value to a device glyph, by label or by id. */
function deviceType(raw: string): DeviceType {
  const want = raw.trim().toLowerCase().replace(/[\s_]/g, '-');
  const ids = Object.keys(DEVICE_LABEL) as DeviceType[];
  return (
    ids.find((id) => id === want) ??
    ids.find((id) => DEVICE_LABEL[id].toLowerCase() === raw.trim().toLowerCase()) ??
    'generic'
  );
}

type Loaded =
  | { kind: 'grid'; source: string; sheets: { name: string; rows: string[][] }[]; sheet: number; headerRow: number; as: ImportKind; mapping: ColumnMapping }
  | { kind: 'netbox'; source: string; found: NetboxImport };

const extension = (path: string) => (path.split(/[\\/]/).pop() ?? '').split('.').pop()?.toLowerCase() ?? '';
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * Building a diagram from a file somebody already has.
 *
 * Most people arrive with an inventory before they arrive with a network they
 * can crawl — a rack list, an IPAM export, a handover document. A CSV or a
 * workbook is read into a grid and every column is matched to a field, with
 * the guess shown and changeable before anything is added. A NetBox export
 * carries its own structure, so it goes straight to devices and cables.
 */
export function CsvImportPanel() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const withSheet = (source: string, sheets: { name: string; rows: string[][] }[], sheet = 0): Loaded => {
    const rows = sheets[sheet]?.rows ?? [];
    const headerRow = headerRowOf(rows);
    const as = guessKind(rows[headerRow] ?? []);
    return { kind: 'grid', source, sheets, sheet, headerRow, as, mapping: guessMapping(rows[headerRow] ?? [], as) };
  };

  const read = async () => {
    setProblem(null);
    setDone(null);
    try {
      const path = await ipc.pickImportFile();
      if (!path) return;
      const ext = extension(path);
      if (ext === 'xlsx' || ext === 'xlsm') {
        const sheets = (await ipc.readSpreadsheet(path)).filter((s) => s.rows.length > 0);
        if (!sheets.length) throw new Error(`${fileName(path)} has no rows on any sheet.`);
        setLoaded(withSheet(path, sheets));
      } else if (ext === 'json' || ext === 'yaml' || ext === 'yml') {
        setLoaded({ kind: 'netbox', source: path, found: readNetbox(await ipc.readImport(path)) });
      } else {
        setLoaded(withSheet(path, [{ name: fileName(path), rows: parseCsv(await ipc.readImport(path)) }]));
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const mapped = useMemo(() => {
    if (loaded?.kind !== 'grid') return null;
    return mapRows(loaded.sheets[loaded.sheet]?.rows ?? [], loaded.mapping, loaded.as, loaded.headerRow);
  }, [loaded]);

  const addNodes = (rows: NodeCsvRow[]) => {
    const store = useStore.getState();
    const bottom = activePage(store.doc).nodes.reduce((m, n) => Math.max(m, n.position.y + 120), 0);
    // Each site's devices together, in a block of its own.
    const { positions, blocks } = placeBySite(rows, { x: 80, y: bottom + 80 });
    const ids: string[] = [];
    rows.forEach((r, i) => {
      const node = makeDeviceNode(deviceType(r.type), positions[i]!.x, positions[i]!.y);
      ids.push(node.id);
      const d = node.data as DeviceNodeData;
      d.label = r.name;
      d.tags = r.tags;
      if (r.notes) d.notes = r.notes;
      if (r.vendor) d.vendor = r.vendor;
      if (r.model) d.model = r.model;
      if (r.serial) d.serial = r.serial;
      if (r.assetTag) d.assetTag = r.assetTag;
      if (r.role) d.role = r.role;
      if (r.site) d.site = r.site;
      if (r.rack) d.rack = r.rack;
      if (r.rackUnits !== undefined) d.rackUnits = r.rackUnits;
      // A sheet that gives the top unit and no height: the height is the
      // one this kind of device is drawn with.
      const lowest = r.rackU ?? (r.rackTop !== undefined ? lowestUnit(r.rackTop, d.rackUnits ?? 1) : undefined);
      if (lowest !== undefined && r.rack) d.rackU = lowest;
      if (r.address) {
        d.addresses = [{ id: uid(), label: 'Imported', address: r.address, isPrimary: true }];
      }
      store.addNode(node);
      // An address in the sheet is there to be watched; a row without one is a
      // box on the diagram and nothing more, so it gets no probe.
      if (r.address && store.meta) {
        const probe = newProbe('node', node.id, store.meta.id, r.address, 'Imported');
        probe.kind = r.probeType;
        if (r.probeType === 'tcp') probe.tcpPort = r.port ?? 443;
        store.upsertProbe(probe);
      }
    });
    // More than one site: a titled frame round each, under its devices.
    if (blocks.length > 1) {
      for (const block of blocks) {
        const frame = frameAround(activePage(useStore.getState().doc).nodes, new Set(block.indexes.map((i) => ids[i]!)), { top: 24 });
        if (!frame) continue;
        const zone = makeDeviceNode('zone', frame.x, frame.y);
        zone.width = frame.width;
        zone.height = frame.height;
        (zone.data as DeviceNodeData).label = block.site;
        useStore.setState((st) => ({ doc: withPage(st.doc, { nodes: withBoxAtBack(activePage(st.doc).nodes, zone) }), dirty: true }));
      }
    }
    // A "connects to" column is a link from each row to the device it
    // names — one already on the page, or one this sheet has just added.
    const uplinks = rows
      .filter((r) => r.uplink && r.uplink.trim().toLowerCase() !== r.name.trim().toLowerCase())
      .map((r): LinkCsvRow => ({ source: r.name, target: r.uplink!, sourcePort: '', targetPort: '', label: '', healthRule: 'both-endpoints' }));
    return [
      `Added ${t('plural.device', { count: rows.length })}${blocks.length > 1 ? ` ${t('csvImportPanel.inSites', { count: blocks.length })}` : ''}.`,
      uplinks.length ? addLinks(uplinks) : '',
    ].filter(Boolean).join(' ');
  };

  const addLinks = (rows: LinkCsvRow[]) => {
    const store = useStore.getState();
    // Names, because a spreadsheet has no way to know the ids this app
    // generates. Matched case-insensitively: a sheet and a diagram rarely
    // agree on capitalisation. Read fresh, so devices added a moment ago by
    // the same import are there.
    const byName = new Map(
      activePage(store.doc)
        .nodes.filter((n) => n.type === 'device')
        .map((n) => [String((n.data as DeviceNodeData).label).trim().toLowerCase(), n.id]),
    );
    let added = 0;
    const missing: string[] = [];
    for (const r of rows) {
      const s = byName.get(r.source.trim().toLowerCase());
      const t = byName.get(r.target.trim().toLowerCase());
      if (!s || !t) {
        missing.push(!s ? r.source : r.target);
        continue;
      }
      // Style is left to the document's default — an imported link
      // should look like a link drawn here, not like whatever this importer
      // happened to hardcode.
      const data: Partial<LinkData> = {
        sourcePortLabel: r.sourcePort,
        targetPortLabel: r.targetPort,
        label: r.label,
        enabled: true,
        maintenance: false,
        healthRule: { type: r.healthRule },
      };
      store.addEdge({ id: uid(), source: s, target: t, sourceHandle: 'b', targetHandle: 't', type: 'live', data } as TopoEdge);
      added += 1;
    }
    const unmatched = [...new Set(missing)];
    return (
      `Added ${t('plural.link', { count: added })}.` +
      (unmatched.length
        ? ` ${unmatched.length} skipped — no device on the diagram called ${unmatched.slice(0, 3).map((n) => `"${n}"`).join(', ')}${unmatched.length > 3 ? '…' : ''}.`
        : '')
    );
  };

  const apply = () => {
    if (!loaded) return;
    if (loaded.kind === 'netbox') {
      setDone([addNodes(loaded.found.devices), loaded.found.links.length ? addLinks(loaded.found.links) : ''].filter(Boolean).join(' '));
    } else if (mapped) {
      setDone(mapped.kind === 'devices' ? addNodes(mapped.rows) : addLinks(mapped.rows));
    }
    setLoaded(null);
  };

  if (!isDesktop) {
    return <p className="cv-help cv-discover-empty">{t('csvImportPanel.readingAFileNeeds')}</p>;
  }

  const header = loaded?.kind === 'grid' ? (loaded.sheets[loaded.sheet]?.rows[loaded.headerRow] ?? []) : [];
  const missingRequired = loaded?.kind === 'grid' ? fieldsFor(loaded.as).filter((f) => f.required && loaded.mapping[f.key] == null) : [];
  const count = loaded?.kind === 'netbox' ? loaded.found.devices.length + loaded.found.links.length : (mapped?.rows.length ?? 0);

  return (
    <div className="cv-discover">
      <div className="cv-discover-form">
        <button type="button" className="cv-btn cv-btn-start" onClick={() => void read()}>
          {t('csvImportPanel.chooseAFile')}
        </button>
        <span className="cv-help">
          A device or link list as CSV or an Excel workbook — you choose which column is which — or a NetBox
          export of devices and cables, as JSON or YAML. Links are matched to devices by name.
        </span>
      </div>

      {problem && <p className="cv-discover-problem">{problem}</p>}
      {done && <p className="cv-help" role="status">{done}</p>}

      {loaded?.kind === 'grid' && (
        <section className="cv-import-map" aria-label={t('csvImportPanel.matchTheColumns')}>
          <p className="cv-help">{fileName(loaded.source)}</p>
          <div className="cv-import-map-head">
            {loaded.sheets.length > 1 && (
              <label className="cv-field cv-field-narrow">
                <span>{t('csvImportPanel.sheet')}</span>
                <select className="cv-input" value={loaded.sheet} onChange={(e) => setLoaded(withSheet(loaded.source, loaded.sheets, Number(e.target.value)))}>
                  {loaded.sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                </select>
              </label>
            )}
            <label className="cv-field cv-field-narrow">
              <span>{t('csvImportPanel.headerRow')}</span>
              <input className="cv-input" type="number" min={1} max={Math.max(1, (loaded.sheets[loaded.sheet]?.rows.length ?? 1))} value={loaded.headerRow + 1}
                onChange={(e) => {
                  const headerRow = Math.max(0, Number(e.target.value) - 1);
                  const h = loaded.sheets[loaded.sheet]?.rows[headerRow] ?? [];
                  setLoaded({ ...loaded, headerRow, mapping: guessMapping(h, loaded.as) });
                }} />
            </label>
            <fieldset className="cv-import-kind">
              <legend>{t('csvImportPanel.eachRowIs')}</legend>
              {(['devices', 'links'] as const).map((k) => (
                <label key={k} className="cv-check cv-check-inline">
                  <input type="radio" name="cv-import-kind" checked={loaded.as === k} onChange={() => setLoaded({ ...loaded, as: k, mapping: guessMapping(header, k) })} />
                  {k === 'devices' ? 'a device' : 'a link'}
                </label>
              ))}
            </fieldset>
          </div>
          <div className="cv-import-fields">
            {fieldsFor(loaded.as).map((f) => (
              <label key={f.key} className="cv-field cv-field-narrow">
                <span>{f.label}{f.required ? ' *' : ''}</span>
                <select className="cv-input" aria-label={`Column for ${f.label}`} value={loaded.mapping[f.key] ?? ''}
                  onChange={(e) => setLoaded({ ...loaded, mapping: { ...loaded.mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) } })}>
                  <option value="">{t('csvImportPanel.notInThisFile')}</option>
                  {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {missingRequired.length > 0 && (
            <p className="cv-discover-problem">Choose a column for {missingRequired.map((f) => f.label.toLowerCase()).join(' and ')}.</p>
          )}
        </section>
      )}

      {loaded?.kind === 'netbox' && (
        <p className="cv-help">
          {fileName(loaded.source)} — {t('plural.device', { count: loaded.found.devices.length })} and{' '}
          {t('plural.cable', { count: loaded.found.links.length })} from NetBox
        </p>
      )}

      {loaded && (
        <>
          {(() => {
            const errors = loaded.kind === 'netbox' ? loaded.found.problems : (mapped?.errors ?? []);
            return errors.length > 0 && (
              <details className="cv-discover-failures">
                <summary>{t('plural.row', { count: errors.length })} could not be used</summary>
                <ul>{errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul>
              </details>
            );
          })()}

          {mapped?.kind === 'devices' && (mapped.headings.length > 0 || mapped.rows.some((r) => r.uplink)) && (
            <p className="cv-help" role="note">
              {[
                mapped.headings.length > 0 ? t('csvImportPanel.headingsRead', { count: mapped.headings.length, first: mapped.headings[0]! }) : '',
                mapped.rows.some((r) => r.uplink) ? t('csvImportPanel.uplinksRead', { count: mapped.rows.filter((r) => r.uplink).length }) : '',
              ].filter(Boolean).join(' ')}
            </p>
          )}

          <div className="cv-discover-actions">
            <button type="button" className="cv-btn cv-btn-start" onClick={apply} disabled={count === 0 || missingRequired.length > 0}>
              Add {count} to diagram
            </button>
            <button type="button" className="cv-btn" onClick={() => setLoaded(null)}>{t('csvImportPanel.cancel')}</button>
          </div>

          {loaded.kind === 'netbox' || mapped?.kind === 'devices' ? (
            <table className="cv-table cv-discover-table">
              <thead>
                <tr><th>{t('csvImportPanel.name')}</th><th>{t('csvImportPanel.type')}</th><th>{t('csvImportPanel.address')}</th><th>{t('csvImportPanel.model')}</th><th>{t('csvImportPanel.siteRack')}</th><th>{t('csvImportPanel.tags')}</th></tr>
              </thead>
              <tbody>
                {(loaded.kind === 'netbox' ? loaded.found.devices : (mapped?.rows as NodeCsvRow[])).slice(0, 200).map((r, i) => (
                  <tr key={`${r.name}-${i}`}>
                    <td>{r.name}</td>
                    <td>{DEVICE_LABEL[deviceType(r.type)]}</td>
                    <td className="cv-mono">{r.address || '—'}</td>
                    <td>{[r.vendor, r.model].filter(Boolean).join(' ') || '—'}</td>
                    <td>{[r.site, r.rack, r.rackU !== undefined ? `U${r.rackU}` : ''].filter(Boolean).join(' / ') || '—'}</td>
                    <td>{r.tags.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {(loaded.kind === 'netbox' ? loaded.found.links : mapped?.kind === 'links' ? mapped.rows : []).length > 0 && (
            <table className="cv-table cv-discover-table">
              <thead>
                <tr><th>{t('csvImportPanel.source')}</th><th>{t('csvImportPanel.target')}</th><th>{t('csvImportPanel.ports')}</th><th>{t('csvImportPanel.label')}</th><th>{t('csvImportPanel.healthRule')}</th></tr>
              </thead>
              <tbody>
                {(loaded.kind === 'netbox' ? loaded.found.links : (mapped?.rows as LinkCsvRow[])).slice(0, 200).map((r, i) => (
                  <tr key={`${r.source}-${r.target}-${i}`}>
                    <td>{r.source}</td>
                    <td>{r.target}</td>
                    <td className="cv-mono">{r.sourcePort || '—'} / {r.targetPort || '—'}</td>
                    <td>{r.label || '—'}</td>
                    <td>{r.healthRule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
