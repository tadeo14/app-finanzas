import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary, StorageProblem } from './components/ErrorScreen';
import { generateDueRecurrings } from './db/recurringRepo';
import { db, SETTINGS_ID } from './db/schema';
import { seedIfEmpty } from './db/seed';
import { startup } from './startup';
import { applyTheme } from './theme';
import './index.css';

registerSW({ immediate: true });

// Pedir almacenamiento persistente para que el navegador no borre IndexedDB por falta de espacio.
void navigator.storage?.persist?.();

const root = createRoot(document.getElementById('root')!);

async function boot() {
  try {
    await seedIfEmpty(db);
  } catch (error) {
    // sin base local la app no sirve: se explica en vez de mostrar pantallas vacías que fallan en silencio
    console.error('No se pudo abrir la base local', error);
    root.render(<StorageProblem error={error} />);
    return;
  }

  try {
    // el tema se aplica antes del primer render para no mostrar un fondo equivocado
    applyTheme((await db.settings.get(SETTINGS_ID))?.theme);
    const result = await generateDueRecurrings(db);
    startup.generated = result.generated;
    startup.failures = result.failures;
  } catch (error) {
    // un recurrente que falla no tiene que impedir usar la app
    console.error('No se pudieron generar los recurrentes', error);
  }

  root.render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void boot();
