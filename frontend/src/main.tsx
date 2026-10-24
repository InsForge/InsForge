import '@insforge/dashboard/styles.css';
import './styles.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { probeCloudHosting } from './helpers.ts';

const rootElement = document.getElementById('root');
if (rootElement) {
  // `App` picks the whole shell from `isCloudHosting()`, so resolve the
  // backend's answer before the first render rather than switching dashboards
  // underneath a mounted tree. `finally` rather than `then`: the probe swallows
  // its own failures today, but mounting must not depend on that staying true —
  // a rejection here would otherwise leave `#root` empty with nothing rendered.
  void probeCloudHosting().finally(() => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
