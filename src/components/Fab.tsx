import { Link, useLocation } from 'react-router-dom';

/** Botón flotante "+" para la carga rápida. Se oculta dentro del propio formulario. */
export default function Fab() {
  const { pathname } = useLocation();
  if (pathname === '/nuevo' || pathname.startsWith('/movimientos/')) return null;
  return (
    <Link
      to="/nuevo"
      aria-label="Cargar movimiento"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-3xl font-light text-white shadow-lg shadow-emerald-900/50 active:bg-emerald-600 sm:right-[calc(50%-14rem+1rem)]"
    >
      +
    </Link>
  );
}
