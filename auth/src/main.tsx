import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { InsforgeProvider } from '@insforge/react';
import './index.css';
import App from './App';
import { getBackendUrl } from './lib/utils';

const backendUrl = getBackendUrl();

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <BrowserRouter>
        <InsforgeProvider baseUrl={backendUrl}>
          <App />
        </InsforgeProvider>
      </BrowserRouter>
    </StrictMode>
  );
}
