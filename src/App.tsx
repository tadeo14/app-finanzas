import { Navigate, Route, Routes } from 'react-router-dom';
import BottomNav from './components/BottomNav';
import Inicio from './pages/Inicio';
import Mas from './pages/Mas';
import Movimientos from './pages/Movimientos';
import Reportes from './pages/Reportes';
import Tarjetas from './pages/Tarjetas';

export default function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <main className="flex-1 px-4 pb-24 pt-[max(1rem,env(safe-area-inset-top))]">
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/movimientos" element={<Movimientos />} />
          <Route path="/tarjetas" element={<Tarjetas />} />
          <Route path="/reportes" element={<Reportes />} />
          <Route path="/mas" element={<Mas />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
