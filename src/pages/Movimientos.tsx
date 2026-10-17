import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';

export default function Movimientos() {
  return (
    <>
      <PageHeader title="Movimientos" />
      <EmptyState>Acá vas a ver tus gastos, ingresos y transferencias.</EmptyState>
    </>
  );
}
