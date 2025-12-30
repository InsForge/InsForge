import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { InsforgeProvider } from '@insforge/react';
import './index.css';
import App from './App';
import { insforge } from './lib/insforge';

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <BrowserRouter>
        <InsforgeProvider client={insforge}>
          <App />
        </InsforgeProvider>
      </BrowserRouter>
    </StrictMode>
  );
}
