// Tema de la app. Funciones puras: la parte que toca el DOM está en src/theme.ts.
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** Sin preferencia guardada se sigue al sistema. */
export function resolveTheme(preference: ThemePreference | undefined, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemPrefersDark ? 'dark' : 'light';
}

/** Color de la barra del navegador (meta theme-color): el del fondo de la app en cada tema. */
export function themeColor(theme: ResolvedTheme): string {
  return theme === 'dark' ? '#0f172a' : '#f1f5f9';
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}
