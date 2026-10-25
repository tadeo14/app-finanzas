import { lazy, Suspense, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import BottomNav from './components/BottomNav';
import Fab from './components/Fab';
import { startup } from './startup';
import Backup from './pages/Backup';
import Categorias from './pages/Categorias';
import Cotizacion from './pages/Cotizacion';
import Cuentas from './pages/Cuentas';
import Inicio from './pages/Inicio';
import Mas from './pages/Mas';
import Movimientos from './pages/Movimientos';
import NuevaCompra from './pages/NuevaCompra';
import NuevoMovimiento from './pages/NuevoMovimiento';
import Presupuestos from './pages/Presupuestos';
import Recurrentes from './pages/Recurrentes';
import TarjetaDetalle from './pages/TarjetaDetalle';
import Tarjetas from './pages/Tarjetas';

// Recharts pesa bastante: se baja solo al abrir Reportes.
const Reportes = lazy(() => import('./pages/Reportes'));

/** Avisa de lo que generaron los recurrentes al abrir la app, y de lo que no se pudo generar. */
function StartupNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || (startup.generated === 0 && startup.failures.length === 0)) return null;
  return (
    <div className="mb-3 space-y-2">
      {startup.generated > 0 && (
        <p role="status" className="flex items-start justify-between gap-3 rounded-xl bg-emerald-950/60 p-3 text-sm text-emerald-200">
          <span>
            Se {startup.generated === 1 ? 'generó 1 movimiento' : `generaron ${startup.generated} movimientos`} de tus{' '}
            <Link to="/mas/recurrentes" className="underline">recurrentes</Link>.
          </span>
          <button type="button" onClick={() => setDismissed(true)} aria-label="Cerrar aviso" className="text-emerald-400">✕</button>
        </p>
      )}
      {startup.failures.length > 0 && (
        <div role="alert" className="rounded-xl bg-red-950/60 p-3 text-sm text-red-200">
          <p className="font-medium">No se pudo generar:</p>
          <ul className="mt-1 list-disc pl-5">
            {startup.failures.map((f, i) => (
              <li key={i}>{f.description}: {f.message}</li>
            ))}
          </ul>
          <p className="mt-2"><Link to="/mas/recurrentes" className="underline">Revisar recurrentes</Link></p>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <main className="flex-1 px-4 pb-24 pt-[max(1rem,env(safe-area-inset-top))]">
        <StartupNotice />
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Inicio />} />
            <Route path="/nuevo" element={<NuevoMovimiento />} />
            <Route path="/nuevo/tarjeta" element={<NuevaCompra />} />
            <Route path="/compras/:id" element={<NuevaCompra />} />
            <Route path="/movimientos" element={<Movimientos />} />
            <Route path="/movimientos/:id" element={<NuevoMovimiento />} />
            <Route path="/tarjetas" element={<Tarjetas />} />
            <Route path="/tarjetas/:cardId" element={<TarjetaDetalle />} />
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/mas" element={<Mas />} />
            <Route path="/mas/cuentas" element={<Cuentas />} />
            <Route path="/mas/categorias" element={<Categorias />} />
            <Route path="/mas/presupuestos" element={<Presupuestos />} />
            <Route path="/mas/cotizacion" element={<Cotizacion />} />
            <Route path="/mas/recurrentes" element={<Recurrentes />} />
            <Route path="/mas/backup" element={<Backup />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <Fab />
      <BottomNav />
    </div>
  );
}
