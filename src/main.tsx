// First, so storage kept under the app's earlier name is moved before the
// store reads it.
import './lib/renamedStorage';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { setLocale } from './i18n';
import { watchClippedFields } from './lib/clippedTitle';
import { watchUnhandled } from './lib/unhandled';
import { useStore } from './state/store';
import './styles.css';

// A fire-and-forget call that failed says so in the status bar
// rather than in a console the bundle has no window for.
watchUnhandled(window, (line) => useStore.getState().setStatusMessage(line));

// A field too short for its value says the rest when pointed at.
watchClippedFields();

// The system's language, where there is a catalogue for it; English
// otherwise, which today is always.
setLocale(navigator.language || 'en');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
