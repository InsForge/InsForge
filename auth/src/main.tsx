import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { InsforgeProvider } from '@insforge/react';
import '@insforge/react/styles.css';
import './index.css';
import App from './App';

// Get backend URL from window.origin
const backendUrl = window.location.hostname.includes('localhost') ? 'http://localhost:7130' : window.location.origin;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <InsforgeProvider baseUrl={backendUrl}>
        <App />
      </InsforgeProvider>
    </BrowserRouter>
  </StrictMode>
);
