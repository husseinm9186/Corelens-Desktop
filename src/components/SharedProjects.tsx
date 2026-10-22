import { useEffect, useState } from 'react';

import { useStore } from '../state/store';
import { isDesktop } from '../lib/ipc';
import { heldBy } from '../lib/sharedProjects';
import { t } from '../i18n';

const when = (ms: number) => new Date(ms).toLocaleString();

/**
 * The company folder: where a team keeps its projects so every engineer's
 * machine opens the same ones. A SharePoint library synced through
 * OneDrive, a mapped drive, a Git checkout — any folder each machine sees.
 *
 * The start screen lists what is in it; Settings → Application chooses it.
 * The folder is this computer's preference. Which projects are kept there
 * is each project's own choice, made under its Settings → Folders.
 */
export function SharedProjectsSection() {
  const folder = useStore((s) => s.settings.sharedProjectsFolder);
  const entries = useStore((s) => s.sharedProjects);
  const projects = useStore((s) => s.projects);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void useStore.getState().refreshSharedProjects();
  }, [folder]);
  if (!isDesktop) return null;

  const act = (what: string, run: () => Promise<unknown>) => {
    setProblem(null);
    setBusy(what);
    void run()
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };
  const onThisMachine = new Set(projects.map((p) => p.id));

  return (
    <section className="cv-welcome-section cv-shared" data-region="shared-projects">
      <div className="cv-pfolder-head">
        <h2>{t('shared.title')}</h2>
        <span className="cv-folder-actions">
          <button type="button" className="cv-btn cv-btn-small" disabled={busy !== null}
            onClick={() => act('choose', () => useStore.getState().chooseSharedFolder())}>
            {folder ? t('shared.change') : t('shared.choose')}
          </button>
          {folder && (
            <>
              <button type="button" className="cv-btn cv-btn-small" disabled={busy !== null}
                onClick={() => act('refresh', () => useStore.getState().refreshSharedProjects())}>
                {t('shared.refresh')}
              </button>
              <button type="button" className="cv-btn cv-btn-small" disabled={busy !== null}
                onClick={() => act('clear', () => useStore.getState().clearSharedFolder())}>
                {t('shared.stopUsing')}
              </button>
            </>
          )}
        </span>
      </div>
      {folder ? (
        <code className="cv-folder-path" data-region="shared-folder">{folder}</code>
      ) : (
        <p className="cv-help">{t('shared.unset')}</p>
      )}
      {folder && entries.length === 0 && <p className="cv-help">{t('shared.empty')}</p>}
      {folder && entries.length > 0 && (
        <ul className="cv-shared-list">
          {entries.map((e) => {
            const here = onThisMachine.has(e.id);
            const held = heldBy(e.lock, when);
            return (
              <li key={e.id} className="cv-shared-row" data-shared={e.id}>
                <span className="cv-shared-text">
                  <span className="cv-project-title">{e.name}</span>
                  <span className="cv-project-meta">
                    {[e.customer, e.site, e.ticket].filter(Boolean).join(' · ') || t('shared.noMetadata')}
                    {' · '}{t('shared.saved', { when: when(e.updatedAt) })}
                    {here && <> · {t('shared.onThisMachine')}</>}
                  </span>
                  {held && <span className="cv-help cv-shared-held" data-region="shared-held">{held}</span>}
                </span>
                <button type="button" className="cv-btn cv-btn-small" disabled={busy !== null}
                  onClick={() => act(e.id, () => useStore.getState().openSharedProject(e))}>
                  {here ? t('shared.open') : t('shared.openFromFolder')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {problem && <p className="cv-error" data-region="shared-problem">{problem}</p>}
    </section>
  );
}

/** Settings → Application: the company folder, chosen once. */
export function SharedSettings() {
  const folder = useStore((s) => s.settings.sharedProjectsFolder);
  const [problem, setProblem] = useState<string | null>(null);
  const act = (run: () => Promise<unknown>) => {
    setProblem(null);
    void run().catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  };
  return (
    <section id="settings-shared" data-settings-section="shared" className="cv-settings-block" data-region="shared-settings">
      <h2>{t('settings.section.shared')}</h2>
      {!isDesktop ? (
        <p className="cv-help">{t('shared.needsApp')}</p>
      ) : (
        <div className="cv-folder-row">
          <div className="cv-folder-head">
            <span className="cv-folder-title">{t('shared.folderTitle')}</span>
            <span className="cv-folder-actions">
              <button type="button" className="cv-btn cv-btn-small" onClick={() => act(() => useStore.getState().chooseSharedFolder())}>
                {folder ? t('shared.change') : t('shared.choose')}
              </button>
              {folder && (
                <button type="button" className="cv-btn cv-btn-small" onClick={() => act(() => useStore.getState().clearSharedFolder())}>
                  {t('shared.stopUsing')}
                </button>
              )}
            </span>
          </div>
          <code className={folder ? 'cv-folder-path' : 'cv-folder-path is-unset'}>{folder ?? t('shared.notChosen')}</code>
          <p className="cv-help">{t('shared.settingsHelp')}</p>
          <p className="cv-help">{t('shared.whatTravels')}</p>
          {problem && <p className="cv-error cv-folder-problem">{problem}</p>}
        </div>
      )}
    </section>
  );
}

/** The banner inside a kept project while somebody else has it open. */
export function SharedNotice() {
  const notice = useStore((s) => s.sharedNotice);
  if (!notice) return null;
  return (
    <div className="cv-shared-notice" role="status" aria-live="polite" data-region="shared-notice">
      {notice}
    </div>
  );
}
