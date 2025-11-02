import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { InsforgeProvider } from '@insforge/react';
import '@insforge/react/styles.css';
import './index.css';
import App from './App';

// Get backend URL from environment or use default
const backendUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:7132';
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
