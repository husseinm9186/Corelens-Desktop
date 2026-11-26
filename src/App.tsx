import { cycleRegion } from './lib/regions';
import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';

import { Canvas } from './components/Canvas';
import { Inspector } from './components/inspector/Inspector';
import { Palette } from './components/Palette';
import { ProjectScreen } from './components/ProjectScreen';
import { SharedNotice } from './components/SharedProjects';
import { HelpScreen } from './components/HelpScreen';
import { RegisterScreen } from './components/RegisterScreen';
import { ToolsScreen } from './components/ToolsScreen';
import { ImportDialog } from './components/ImportDialog';
import { StatusPanel } from './components/StatusPanel';
import { DockHost } from './components/DockHost';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DrawerHost } from './components/Drawer';
import { TopBar } from './components/TopBar';
import { ipc, isDesktop } from './lib/ipc';

/** The keychain is asked at most once per window. */
let keychainTried = false;
/** The at-start check for a newer release, likewise once per window. */
let updateCheckTried = false;
import { useStore } from './state/store';
import { autoUiScale, dockSideFor, dockWidthClass, fitColumns, stepUiScale } from './lib/dockPlacement';
import { NavRail } from './components/NavRail';
import { CanvasToolbar } from './components/CanvasToolbar';

import { DESKTOP_APP_URL } from './components/EmptyState';
import { t } from './i18n';
import { installRowKeys } from './lib/rowKeys';

/** The smallest interface scale high contrast allows. */
const CONTRAST_SCALE_FLOOR = 1.15;

export default function App() {
  const meta = useStore((s) => s.meta);
  const highContrast = useStore((s) => s.settings.highContrast);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);
  const uiScale = useStore((s) => s.settings.uiScale);
  const dockTab = useStore((s) => s.dockTab);
  const dockPlacements = useStore((s) => s.dockPlacements);
  const dockDetached = useStore((s) => s.dockDetached);
  const selection = useStore((s) => s.selectedNodeId ?? s.selectedEdgeId);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const inspectorOpen = useStore((s) => s.inspectorOpen);
  const sshSessions = useStore((s) => s.sshSessions);
  // An empty terminal tab is narrow until a session opens in it.
  const dockHasSession = dockTab === 'console' ? sshSessions.some((x) => x.console) : sshSessions.some((x) => !x.console);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [keepPalette, setKeepPalette] = useState(false);
  const [keepInspector, setKeepInspector] = useState(false);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const scale = uiScale === 'auto' ? autoUiScale(vw) : uiScale;
  const effectiveScale = highContrast ? Math.max(CONTRAST_SCALE_FLOOR, scale) : scale;
  // The root size the stylesheet sets, `html { font-size }`, at this scale;
  // the body is the window less the navigation rail.
  const rem = Math.min(16, Math.max(13, 0.0025 * vw + 9)) * effectiveScale;
  const preferredSide = dockDetached ? 'bottom' : dockSideFor(dockTab, dockPlacements);
  const fit = fitColumns({
    body: vw - 4.92307692 * rem, vw, rem,
    dock: dockWidthClass(dockTab, dockHasSession) === 'is-dock-wide' ? 'wide' : 'narrow',
    selection: Boolean(selection), paletteOpen, inspectorOpen, keepPalette, keepInspector,
  });
  const roomBelow = preferredSide === 'right' && fit.dockBelow;
  useEffect(() => {
    if (useStore.getState().dockBelowForRoom !== roomBelow) useStore.setState({ dockBelowForRoom: roomBelow });
  }, [roomBelow]);
  // In its own window the dock takes no room here at all.
  const dockSide = roomBelow ? 'bottom' : preferredSide;
  const paletteShown = dockSide === 'right' ? fit.palette : paletteOpen;
  const inspectorShown = dockSide === 'right' ? fit.inspector : inspectorOpen;
  // Maximise is a bottom-dock idea: a right dock already takes a column, and
  // the canvas must not vanish when a tall tab opens beside it.
  const dockMax = useStore((s) => s.dockMax) && dockSide === 'bottom';
  const ground = useStore((s) => s.settings.ground);
  const applyEngineEvent = useStore((s) => s.applyEngineEvent);
  // Read above the early return: a hook after one is called conditionally,
  // which React rejects and which broke the move from the launcher into a
  // project entirely.
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const setInspectorOpen = useStore((s) => s.setInspectorOpen);
  const presenting = useStore((s) => s.presenting);
  const registerOpen = useStore((s) => s.registerOpen);
  const helpOpen = useStore((s) => s.helpOpen);
  const toolsOpen = useStore((s) => s.toolsOpen);

  // Up and Down between the rows of any table.
  useEffect(() => installRowKeys(), []);

  // The chrome's scale, on the root element so every rem follows it.
  useEffect(() => {
    // High contrast is a bigger build as well as a starker one: never under
    // 115 %, so the smallest text is still 12 px.
    document.documentElement.style.setProperty('--ui-scale', String(effectiveScale));
  }, [effectiveScale]);

  // Ctrl+Shift + and − size the whole interface, Ctrl+Shift+0 hands it back
  // to the window. By key position, so the shifted characters do not
  // matter; Ctrl + and − without Shift stay the diagram's zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const st = useStore.getState();
      const now = st.settings.uiScale === 'auto' ? autoUiScale(window.innerWidth) : st.settings.uiScale;
      let next: number | 'auto';
      if (e.code === 'Equal' || e.code === 'NumpadAdd') next = stepUiScale(now, 1);
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') next = stepUiScale(now, -1);
      else if (e.code === 'Digit0' || e.code === 'Numpad0') next = 'auto';
      else return;
      e.preventDefault();
      e.stopPropagation();
      st.setSettings({ uiScale: next });
      st.setStatusMessage(next === 'auto' ? t('settings.uiScaleAutoSaid') : t('settings.uiScaleSaid', { percent: Math.round(next * 100) }));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Presentation takes the whole screen where the window can go full
  // screen, and leaving full screen by the system's own means leaves
  // presentation too. Where full screen is refused, the chrome still goes.
  useEffect(() => {
    if (!presenting) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      return;
    }
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) useStore.getState().setPresenting(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [presenting]);

  // A vault whose key this machine keeps opens by itself — once per
  // window, however often the effect runs.
  useEffect(() => {
    if (keychainTried) return;
    keychainTried = true;
    void ipc.unlockVaultFromKeychain().then((r) => {
      if (r === 'stale') useStore.getState().setStatusMessage('The key kept in the system keychain no longer opens the vault, so it was removed. Unlock with the passphrase.');
    }).catch((e: unknown) => useStore.getState().setStatusMessage(e instanceof Error ? e.message : String(e)));
  }, []);

  // Asks GitHub for a newer release at start only if the setting says
  // so; with it off, which it is until switched on, nothing is sent.
  useEffect(() => {
    if (updateCheckTried) return;
    updateCheckTried = true;
    void useStore.getState().startupUpdateCheck().catch(() => undefined);
  }, []);

  // Engine events arrive on one channel for the life of the window.
  useEffect(() => {
    let un: (() => void) | undefined;
    void ipc.onEngineEvent(applyEngineEvent).then((f) => {
      un = f;
    });
    return () => un?.();
  }, [applyEngineEvent]);

  // The running jobs, listed once on load and then kept current by
  // one event for every change, whichever panel started the job.
  useEffect(() => {
    let un: (() => void) | undefined;
    void ipc.listJobs().then((jobs) => useStore.getState().setJobs(jobs)).catch(() => undefined);
    void ipc.onJob((j) => useStore.getState().applyJobEvent(j)).then((f) => {
      un = f;
    });
    return () => un?.();
  }, []);

  // Belt and braces alongside the Rust-side window close handler.
  useEffect(() => {
    const stop = () => {
      if (useStore.getState().session.state !== 'stopped') void ipc.stopValidation();
    };
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, []);

  // F6 and Shift+F6 move between the toolbar, palette, diagram,
  // inspector and bottom panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F6') return;
      e.preventDefault();
      cycleRegion(e.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!meta) {
    return (
      <div className={`cv-app ${highContrast ? 'is-contrast' : ''} ${ground === 'light' ? 'is-light' : ''} ${reduceMotion ? 'is-reduce-motion' : ''}`}>
        {!isDesktop && (
          <div className="cv-browser-banner">
            <span>{t('banner.browser')}</span>
            <a href={DESKTOP_APP_URL} target="_blank" rel="noreferrer noopener">{t('banner.getApp')}</a>
          </div>
        )}
        <ProjectScreen />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div
        className={`cv-app cv-workspace ${highContrast ? 'is-contrast' : ''} ${ground === 'light' ? 'is-light' : ''} ${reduceMotion ? 'is-reduce-motion' : ''}${
          presenting ? ' is-presenting' : ''
        }`}
      >
        {/* The rail names the modes; everything else is the shell beside it. */}
        <ErrorBoundary what="The rail"><NavRail /></ErrorBoundary>
        <div className="cv-shell">
        <ErrorBoundary what="The toolbar"><TopBar onExit={() => undefined} /></ErrorBoundary>
        {/* Who else has a kept project open, while they do. */}
        <SharedNotice />
        {/* A device or a finding, at a width the rail cannot give. */}
        <ErrorBoundary what="The drawer"><DrawerHost /></ErrorBoundary>
        {/* The register takes the whole workspace when it is open. The
            diagram below stays mounted — React Flow rebuilds its viewport from
            scratch when unmounted, so leaving the register would otherwise come
            back to a diagram that had jumped. */}
        {registerOpen && (
          <ErrorBoundary what="The address register"><RegisterScreen /></ErrorBoundary>
        )}
        {/* Compare, Racks and the two imports, out of the bottom panel. */}
        {toolsOpen && <ErrorBoundary what="The tools"><ToolsScreen /></ErrorBoundary>}
        {helpOpen && <ErrorBoundary what="The guide"><HelpScreen /></ErrorBoundary>}
        <ErrorBoundary what="Import"><ImportDialog /></ErrorBoundary>
        {/* The narrow layouts show the palette or the inspector, not both,
            and which one depends on whether there is something to inspect. */}
        {/* The body holds the canvas and the dock, so the dock can sit
            along the bottom or, popped out, down the right. */}
        {/* Presenting, the dock is hidden and the diagram is the whole
            window: none of a right dock's columns or widths apply. */}
        <div className={`cv-body${dockSide === 'right' && !presenting ? ` is-dock-right ${dockWidthClass(dockTab, dockHasSession)}` : ''}${dockMax ? ' is-dock-max' : ''}${registerOpen || helpOpen || toolsOpen ? ' is-behind' : ''}`}>
        <div
          className={[
            'cv-main',
            registerOpen || helpOpen || toolsOpen ? 'is-behind' : '',
            selection ? 'has-selection' : '',
            paletteShown ? '' : 'palette-hidden',
            inspectorShown ? '' : 'inspector-hidden',
          ]
            .filter(Boolean)
            .join(' ')}
          style={dockSide === 'right' && !presenting && fit.mainMin ? { minWidth: `${fit.mainMin}px` } : undefined}
        >
          {/* Both stay mounted and are hidden in CSS. Unmounting one leaves
              two children in a three-track grid, and the canvas slides into
              the collapsed track — which is how the inspector ended up
              occupying the middle of the window. */}
          <ErrorBoundary what="The shape palette"><Palette /></ErrorBoundary>
          {/* The canvas toolbar is a row docked above the pane, not a
              float on it — a float stole the top-left band from pointer work
              (lassos, drops, the harnesses' clicks), and the overlays measure
              themselves against `.cv-canvas`, which must stay the pane. */}
          <div className="cv-canvas-col">
            <ErrorBoundary what="The canvas toolbar"><CanvasToolbar /></ErrorBoundary>
            <ErrorBoundary what="The diagram"><Canvas /></ErrorBoundary>
          </div>
          <ErrorBoundary what="The inspector"><Inspector /></ErrorBoundary>

          {/* Slim rails, so the way back is always visible. A panel that
              hides with no handle left behind reads as something broken. */}
          <button
            type="button"
            className="cv-rail cv-rail-left"
            // Brought back by hand after being folded for room, it stays.
            onClick={() => { setPaletteOpen(!paletteShown); setKeepPalette(!paletteShown); }}
            title={paletteShown ? 'Hide the shapes panel' : 'Show the shapes panel'}
            aria-label={paletteShown ? 'Hide the shapes panel' : 'Show the shapes panel'}
            aria-expanded={paletteShown}
          >
            {paletteShown ? '‹' : '›'}
          </button>
          <button
            type="button"
            className="cv-rail cv-rail-right"
            // Brought back by hand after being folded for room, it stays.
            onClick={() => { setInspectorOpen(!inspectorShown); setKeepInspector(!inspectorShown); }}
            title={inspectorShown ? 'Hide the details panel' : 'Show the details panel'}
            aria-label={inspectorShown ? 'Hide the details panel' : 'Show the details panel'}
            aria-expanded={inspectorShown}
          >
            {inspectorShown ? '›' : '‹'}
          </button>
        </div>
        <DockHost
          appClass={`cv-app ${highContrast ? 'is-contrast' : ''} ${ground === 'light' ? 'is-light' : ''} ${reduceMotion ? 'is-reduce-motion' : ''}`}
          inPlace={!registerOpen && !helpOpen && !toolsOpen}
        >
          <ErrorBoundary what="The monitoring panel"><StatusPanel /></ErrorBoundary>
        </DockHost>
        </div>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
