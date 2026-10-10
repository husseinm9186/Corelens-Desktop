/**
 * The screens the rail names that are not the register: Racks, Inventory
 * and Settings, each in the one frame every full screen uses.
 *
 * They used to share a Tools screen with Compare and the two imports, which
 * made "Tools" a drawer of unrelated things nobody could find by name.
 * Compare is watching what changed, so it is in the dock's Monitor group;
 * the imports bring a diagram in, so they are Import… in the top bar. What
 * is left are places to go, and the rail goes to them.
 *
 * The diagram stays mounted behind, so leaving comes back to the same
 * selection and the same viewport.
 */
import { t } from '../i18n';
import { RackPanel } from './RackPanel';
import { SettingsView } from './SettingsView';
import { useStore } from '../state/store';
import { LifecyclePanel } from './LifecyclePanel';
import { ScreenFrame } from './ScreenFrame';

export type ToolsView = 'compare' | 'racks' | 'csv' | 'visio' | 'lifecycle' | 'settings';

export function ToolsScreen() {
  const close = useStore((s) => s.setToolsOpen);
  const view = useStore((s) => s.toolsView);
  const done = () => close(false);

  if (view === 'racks') {
    return (
      <ScreenFrame title={t('nav.racks')} className="cv-tools" region="tools" wide onClose={done}>
        <RackPanel />
      </ScreenFrame>
    );
  }
  if (view === 'lifecycle') {
    return (
      <ScreenFrame title={t('nav.inventory')} className="cv-tools" region="tools" onClose={done}>
        <LifecyclePanel />
      </ScreenFrame>
    );
  }
  return (
    <ScreenFrame title={t('settings.title')} className="cv-tools" region="tools" wide onClose={done}>
      <SettingsView />
    </ScreenFrame>
  );
}
