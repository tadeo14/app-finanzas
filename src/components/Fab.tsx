import { Link, useLocation } from 'react-router-dom';

/** Botón flotante "+" para la carga rápida. Se oculta dentro de los formularios de carga y edición. */
export default function Fab() {
  const { pathname } = useLocation();
  if (['/nuevo', '/movimientos/', '/compras/'].some((p) => pathname.startsWith(p))) return null;
  return (
    <Link
      to="/nuevo"
      aria-label="Cargar movimiento"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-3xl font-light text-white shadow-lg shadow-emerald-900/50 active:bg-brand-hover sm:right-[calc(50%-14rem+1rem)]"
    >
      +
    </Link>
  );
}
