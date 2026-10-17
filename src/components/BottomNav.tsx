import { NavLink } from 'react-router-dom';

const ITEMS = [
  { to: '/', label: 'Inicio', icon: '🏠' },
  { to: '/movimientos', label: 'Movimientos', icon: '📋' },
  { to: '/tarjetas', label: 'Tarjetas', icon: '💳' },
  { to: '/reportes', label: 'Reportes', icon: '📊' },
  { to: '/mas', label: 'Más', icon: '☰' },
];

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-800 bg-slate-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-emerald-400' : 'text-slate-400'}`
              }
            >
              <span aria-hidden className="text-xl leading-none">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
