/**
 * Import… → From a project: a `.corelens` file someone exported, either
 * added to the open project as pages or opened as a project of its own.
 *
 * As pages, the ticked pages are merged in with fresh ids throughout (see
 * lib/importPages.ts), as one undo step. Saved credentials never come this
 * way: they are sealed with the other machine's passphrase, and the start
 * screen's import is where that is asked about, so a file that carries them
 * says so and points at the other button.
 */
import { useRef, useState } from 'react';

import { t } from '../i18n';
import { ipc, isDesktop } from '../lib/ipc';
import { parseProjectPackage, useStore, type ProjectPackageFile } from '../state/store';

export function ProjectImportPanel({ onDone }: { onDone: () => void }) {
  const [pkg, setPkg] = useState<ProjectPackageFile | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const take = (text: string) => {
    const got = parseProjectPackage(text);
    const pages = Array.isArray(got.document.pages) ? got.document.pages : [];
    if (pages.length === 0) throw new Error(t('importProject.noPages'));
    setPkg(got);
    setChosen(new Set(pages.map((p) => p.id)));
  };
  const failed = (err: unknown) =>
    setError(t('importProject.unreadable', { why: err instanceof Error ? err.message : String(err) }));

  const pick = async () => {
    setError(null);
    if (!isDesktop) {
      fileRef.current?.click();
      return;
    }
    try {
      const path = await ipc.pickProjectFile();
      if (!path) return;
      setBusy(true);
      take(await ipc.readImport(path));
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const fromInput = async (file: File) => {
    setError(null);
    try {
      take(await file.text());
    } catch (err) {
      failed(err);
    }
  };

  const toggle = (id: string) =>
    setChosen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addPages = () => {
    if (!pkg) return;
    const got = useStore.getState().importPagesFrom(pkg.document, [...chosen], pkg.meta.name);
    if (got.pages === 0) return;
    useStore.getState().setStatusMessage(
      t('importProject.added', {
        pages: t('plural.page', { count: got.pages }),
        devices: t('plural.device', { count: got.devices }),
        links: t('plural.link', { count: got.links }),
        checks: t('plural.check', { count: got.probes }),
        name: pkg.meta.name,
      }),
    );
    onDone();
  };

  const separate = () => {
    if (!pkg) return;
    void useStore.getState().importAsSeparateProject(pkg);
  };

  const pages = pkg?.document.pages ?? [];
  return (
    <div className="cv-project-import" data-region="project-import">
      <p className="cv-muted">{t('importProject.lead')}</p>
      <div className="cv-project-import-pick">
        <button type="button" className="cv-btn" data-action="pick-project" disabled={busy} onClick={() => void pick()}>
          {busy ? t('importProject.reading') : pkg ? t('importProject.chooseAnother') : t('importProject.choose')}
        </button>
        {!isDesktop && (
          <input
            ref={fileRef}
            type="file"
            hidden
            data-input="project-file"
            accept=".corelens,.coreview,.livetopo,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void fromInput(f);
              e.target.value = '';
            }}
          />
        )}
      </div>
      {error && <p className="cv-error" role="alert">{error}</p>}

      {pkg && (
        <>
          <h3 className="cv-project-import-name">{pkg.meta.name}</h3>
          <ul className="cv-project-import-pages">
            {pages.map((p) => {
              const devices = p.nodes.filter((n) => n.type === 'device').length;
              return (
                <li key={p.id}>
                  <label>
                    <input type="checkbox" data-page={p.name} checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
                    <span className="cv-project-import-page">{p.name}</span>
                    <span className="cv-muted">
                      {t('plural.device', { count: devices })} · {t('plural.link', { count: p.edges.length })}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {pkg.vault !== undefined && pkg.vault !== null && <p className="cv-muted" data-note="credentials">{t('importProject.credentialsNote')}</p>}
          <div className="cv-project-import-actions">
            <button type="button" className="cv-btn cv-btn-primary" data-action="import-as-pages" disabled={chosen.size === 0} onClick={addPages}>
              {t('importProject.addPages', { pages: t('plural.page', { count: chosen.size }) })}
            </button>
            <button type="button" className="cv-btn" data-action="import-as-project" onClick={separate}>
              {t('importProject.separate')}
            </button>
          </div>
          <p className="cv-muted cv-project-import-foot">{t('importProject.separateNote')}</p>
        </>
      )}
    </div>
  );
}
