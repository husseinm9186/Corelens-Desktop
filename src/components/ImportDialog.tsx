/**
 * Import…, from the top bar: the ways a diagram comes in from elsewhere,
 * side by side — a file of devices and links (CSV and the formats beside
 * it), a drawing someone made in another tool, or another Corelens project
 * — and then the one chosen. Both used to be tabs on a Tools screen, which is not
 * where anyone looks for an import.
 */
import { useEffect } from 'react';

import { t } from '../i18n';
import { useStore } from '../state/store';
import { CsvImportPanel } from './CsvImportPanel';
import { ProjectImportPanel } from './ProjectImportPanel';
import { VisioImportPanel } from './VisioImportPanel';

export function ImportDialog() {
  const open = useStore((s) => s.importOpen);
  const setOpen = useStore((s) => s.setImportOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="cv-modal-backdrop" role="presentation" onMouseDown={() => setOpen(null)}>
      <div
        className={`cv-modal cv-import-dialog${open === 'choose' ? '' : ' is-open'}`}
        role="dialog"
        aria-label={t('import.title')}
        data-region="import-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cv-import-head">
          {open !== 'choose' && (
            <button type="button" className="cv-link-btn" onClick={() => setOpen('choose')}>
              ‹ {t('import.bothSources')}
            </button>
          )}
          <h2>{open === 'csv' ? t('tools.csv') : open === 'visio' ? t('tools.visio') : open === 'project' ? t('tools.project') : t('import.title')}</h2>
          <button type="button" className="cv-btn cv-btn-small cv-import-close" onClick={() => setOpen(null)}>
            {t('import.close')}
          </button>
        </div>
        {open === 'choose' ? (
          <div className="cv-import-choices">
            <button type="button" className="cv-start-card" data-source="csv" onClick={() => setOpen('csv')}>
              <span className="cv-start-title">{t('tools.csv')}</span>
              <span className="cv-start-blurb">{t('import.csvBlurb')}</span>
            </button>
            <button type="button" className="cv-start-card" data-source="visio" onClick={() => setOpen('visio')}>
              <span className="cv-start-title">{t('tools.visio')}</span>
              <span className="cv-start-blurb">{t('import.visioBlurb')}</span>
            </button>
            <button type="button" className="cv-start-card" data-source="project" onClick={() => setOpen('project')}>
              <span className="cv-start-title">{t('tools.project')}</span>
              <span className="cv-start-blurb">{t('import.projectBlurb')}</span>
            </button>
          </div>
        ) : (
          <div className="cv-import-body cv-tools-body">
            {open === 'csv' ? <CsvImportPanel /> : open === 'project' ? <ProjectImportPanel onDone={() => setOpen(null)} /> : <VisioImportPanel onImported={() => setOpen(null)} />}
          </div>
        )}
      </div>
    </div>
  );
}
