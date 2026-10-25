// Aplica el tema al documento y permite que los componentes lo lean (los gráficos necesitan colores en hex).
import { useSyncExternalStore } from 'react';
import { resolveTheme, themeColor, type ResolvedTheme, type ThemePreference } from './domain/theme';

const listeners = new Set<() => void>();
let preference: ThemePreference | undefined;

const systemPrefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;

export function currentTheme(): ResolvedTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Cambia el tema del documento según la preferencia (y el sistema, si la preferencia es "automático"). */
export function applyTheme(next: ThemePreference | undefined): void {
  preference = next;
  const theme = resolveTheme(next, systemPrefersDark());
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(theme));
  listeners.forEach((listener) => listener());
}

// En automático, seguir al dispositivo si cambia (por ejemplo, el modo oscuro nocturno).
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (preference === undefined || preference === 'system') applyTheme(preference);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, currentTheme);
}
