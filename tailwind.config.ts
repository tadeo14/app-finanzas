import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';
import plugin from 'tailwindcss/plugin';

// Temas: la app se escribió con la escala oscura de Tailwind (slate-950 de fondo, slate-900 de tarjeta, etc.).
// En vez de duplicar cada clase, las familias que usa la app se definen con variables CSS: en modo oscuro valen
// lo de siempre y en modo claro se "dan vuelta" (el 950 pasa a ser un tono muy claro). Así `bg-slate-900` es
// una tarjeta oscura o blanca según el tema. Los tonos del modo claro están ajustados a mano para que el texto
// conserve contraste (por ejemplo, text-emerald-400 pasa a un verde más oscuro).
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;
type Shade = (typeof SHADES)[number];
type Scale = Record<Shade, string>;

const FAMILIES = ['slate', 'emerald', 'red', 'amber', 'sky'] as const;
type Family = (typeof FAMILIES)[number];

const LIGHT: Record<Family, Scale> = {
  slate: { 50: '#020617', 100: '#0f172a', 200: '#1e293b', 300: '#334155', 400: '#475569', 500: '#64748b', 600: '#94a3b8', 700: '#cbd5e1', 800: '#e2e8f0', 900: '#ffffff', 950: '#f1f5f9' },
  emerald: { 50: '#022c22', 100: '#064e3b', 200: '#065f46', 300: '#065f46', 400: '#047857', 500: '#10b981', 600: '#059669', 700: '#6ee7b7', 800: '#a7f3d0', 900: '#d1fae5', 950: '#ecfdf5' },
  red: { 50: '#450a0a', 100: '#450a0a', 200: '#7f1d1d', 300: '#b91c1c', 400: '#dc2626', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#fecaca', 950: '#fef2f2' },
  amber: { 50: '#451a03', 100: '#451a03', 200: '#78350f', 300: '#92400e', 400: '#b45309', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#fde68a', 950: '#fffbeb' },
  sky: { 50: '#082f49', 100: '#082f49', 200: '#0c4a6e', 300: '#0369a1', 400: '#0284c7', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985', 900: '#bae6fd', 950: '#f0f9ff' },
};

/** '#0f172a' → '15 23 42' (canales para usar con opacidad: rgb(var(--x) / <alpha-value>)). */
function channels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

const themed: Record<string, Record<string, string>> = {};
const lightVars: Record<string, string> = {};
const darkVars: Record<string, string> = {};
for (const family of FAMILIES) {
  themed[family] = {};
  for (const shade of SHADES) {
    themed[family]![shade] = `rgb(var(--c-${family}-${shade}) / <alpha-value>)`;
    lightVars[`--c-${family}-${shade}`] = channels(LIGHT[family][shade]);
    darkVars[`--c-${family}-${shade}`] = channels((colors[family] as Record<string, string>)[shade]!);
  }
}

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ...themed,
        // Botones principales: igual en ambos temas, texto blanco con contraste AA (5,5:1).
        brand: { DEFAULT: '#047857', hover: '#065f46' },
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ':root': { ...lightVars, colorScheme: 'light' },
        '.dark': { ...darkVars, colorScheme: 'dark' },
      });
    }),
  ],
} satisfies Config;
