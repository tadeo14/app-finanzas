import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { db } from './db/schema';
import { seedIfEmpty } from './db/seed';
import './index.css';

registerSW({ immediate: true });

// Pedir almacenamiento persistente para que el navegador no borre IndexedDB por falta de espacio.
void navigator.storage?.persist?.();

seedIfEmpty(db)
  .catch((error: unknown) => console.error('No se pudo inicializar la base local', error))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    );
  });
