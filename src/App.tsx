import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import BottomNav from './components/BottomNav';
import Fab from './components/Fab';
import Categorias from './pages/Categorias';
import Cotizacion from './pages/Cotizacion';
import Cuentas from './pages/Cuentas';
import Inicio from './pages/Inicio';
import Mas from './pages/Mas';
import Movimientos from './pages/Movimientos';
import NuevaCompra from './pages/NuevaCompra';
import NuevoMovimiento from './pages/NuevoMovimiento';
import Presupuestos from './pages/Presupuestos';
import TarjetaDetalle from './pages/TarjetaDetalle';
import Tarjetas from './pages/Tarjetas';

// Recharts pesa bastante: se baja solo al abrir Reportes.
const Reportes = lazy(() => import('./pages/Reportes'));

export default function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <main className="flex-1 px-4 pb-24 pt-[max(1rem,env(safe-area-inset-top))]">
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <Fab />
      <BottomNav />
    </div>
  );
}
