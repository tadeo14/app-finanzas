import { Link } from 'react-router-dom';
import { Segmented } from '../components/ui';
import type { ThemePreference } from '../domain/theme';
import { saveTheme } from '../db/catalogRepo';
import { db } from '../db/schema';
import { useSettings } from '../hooks/useData';
import { useResolvedTheme } from '../theme';

const HINT: Record<ThemePreference, string> = {
  system: 'La app usa el modo claro u oscuro de tu dispositivo y cambia sola cuando él cambia.',
  light: 'Siempre claro, aunque tu dispositivo esté en modo oscuro.',
  dark: 'Siempre oscuro: descansa la vista de noche y ahorra batería en pantallas OLED.',
};

export default function Apariencia() {
  const settings = useSettings();
  const resolved = useResolvedTheme();
  if (settings === undefined) return null;
  const preference: ThemePreference = settings.theme ?? 'system';

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/mas" aria-label="Volver" className="py-1 pr-2 text-xl text-slate-400">‹</Link>
        <h1 className="text-2xl font-semibold">Apariencia</h1>
      </div>
      <Segmented<ThemePreference>
        value={preference}
        onChange={(value) => void saveTheme(db, value)}
        options={[
          { value: 'system', label: 'Automático' },
          { value: 'light', label: 'Claro' },
          { value: 'dark', label: 'Oscuro' },
        ]}
      />
      <p className="mt-3 text-sm text-slate-400">{HINT[preference]}</p>
      <p className="mt-1 text-xs text-slate-500">Ahora se ve en modo {resolved === 'dark' ? 'oscuro' : 'claro'}.</p>
    </>
  );
}
