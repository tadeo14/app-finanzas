export default function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
      {children}
    </p>
  );
}
