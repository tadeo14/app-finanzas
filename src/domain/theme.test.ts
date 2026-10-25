import { describe, expect, it } from 'vitest';
import { isThemePreference, resolveTheme, themeColor } from './theme';

describe('resolveTheme', () => {
  it('una preferencia explícita manda sobre el sistema', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('automático y sin preferencia siguen al sistema', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme(undefined, false)).toBe('light');
  });
});

describe('themeColor y validación', () => {
  it('cada tema tiene su color de barra', () => {
    expect(themeColor('dark')).toBe('#0f172a');
    expect(themeColor('light')).toBe('#f1f5f9');
  });

  it('reconoce solo las tres preferencias', () => {
    expect(['system', 'light', 'dark'].every(isThemePreference)).toBe(true);
    expect(['auto', '', null, undefined, 1].some(isThemePreference)).toBe(false);
  });
});
