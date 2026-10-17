import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';

export default function Reportes() {
  return (
    <>
      <PageHeader title="Reportes" />
      <EmptyState>Los gráficos aparecen cuando cargues movimientos.</EmptyState>
    </>
  );
}
