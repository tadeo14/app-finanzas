import { useLiveQuery } from 'dexie-react-hooks';
import PageHeader from '../components/PageHeader';
import { db } from '../db/schema';

export default function Mas() {
  const categoryCount = useLiveQuery(() => db.categories.count());
  return (
    <>
      <PageHeader title="Más" />
      <section className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">
        <p>Categorías cargadas: {categoryCount ?? '…'}</p>
        <p className="mt-2 text-slate-500">Cuentas, categorías, presupuestos y backup llegan en las próximas fases.</p>
      </section>
    </>
  );
}
