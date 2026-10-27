import { Link } from 'react-router-dom';
import BackupReminder from '../components/BackupReminder';
import PageHeader from '../components/PageHeader';

const ITEMS = [
  { to: '/mas/cuentas', label: 'Cuentas', detail: 'Bancos, efectivo y billeteras', icon: '🏦' },
  { to: '/mas/categorias', label: 'Categorías', detail: 'Con subcategorías', icon: '🏷️' },
  { to: '/mas/presupuestos', label: 'Presupuestos', detail: 'Límite mensual por categoría', icon: '🎯' },
  { to: '/mas/importar', label: 'Importar movimientos', detail: 'Desde un CSV o una planilla', icon: '📥' },
  { to: '/mas/recurrentes', label: 'Recurrentes', detail: 'Gastos fijos y suscripciones', icon: '🔁' },
  { to: '/mas/apariencia', label: 'Apariencia', detail: 'Claro, oscuro o automático', icon: '🌓' },
  { to: '/mas/cotizacion', label: 'Cotización del dólar', detail: 'Para los totales en pesos', icon: '💵' },
  { to: '/mas/backup', label: 'Backup', detail: 'Exportar e importar tus datos', icon: '💾' },
];

export default function Mas() {
  return (
    <>
      <PageHeader title="Más" />
      <BackupReminder />
      <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-900">
        {ITEMS.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="flex items-center gap-3 px-3 py-4 active:bg-slate-800">
              <span aria-hidden className="text-xl">{item.icon}</span>
              <span className="flex-1">
                <span className="block font-medium">{item.label}</span>
                <span className="block text-xs text-slate-500">{item.detail}</span>
              </span>
              <span className="text-slate-500">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
