import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';

export default function Inicio() {
  return (
    <>
      <PageHeader title="Inicio" />
      <EmptyState>Todavía no hay datos. Empezá creando una cuenta desde Más.</EmptyState>
    </>
  );
}
