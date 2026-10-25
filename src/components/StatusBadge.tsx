import type { StatementStatus } from '../domain/cards';

const STYLE: Record<StatementStatus, { label: string; className: string }> = {
  open: { label: 'Abierto', className: 'bg-sky-950 text-sky-300' },
  closed: { label: 'Cerrado', className: 'bg-amber-950 text-amber-300' },
  paid: { label: 'Pagado', className: 'bg-emerald-950 text-emerald-300' },
  partial: { label: 'Pago parcial', className: 'bg-amber-950 text-amber-300' },
  overdue: { label: 'Vencido', className: 'bg-red-950 text-red-300' },
};

export default function StatusBadge({ status }: { status: StatementStatus }) {
  const { label, className } = STYLE[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>{label}</span>;
}
