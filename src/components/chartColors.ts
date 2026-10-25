// Colores de los gráficos, uno por tema. Las paletas categóricas se validaron con el validador de dataviz
// contra la superficie de las tarjetas de cada tema (oscuro: #0f172a, claro: #ffffff): banda de luminosidad,
// croma, separación para daltonismo y piso en visión normal. El orden es fijo: nunca se cicla ni se generan
// tonos nuevos. En el tema claro tres series (aguamarina, amarillo y magenta) quedan debajo de 3:1 de contraste
// contra el blanco: por eso la lista de la dona muestra siempre el nombre y el monto de cada segmento.
import type { ResolvedTheme } from '../domain/theme';

export interface ChartColors {
  /** Series categóricas en orden fijo. */
  series: readonly string[];
  /** "Otros" y todo lo que no es una serie con nombre. */
  other: string;
  surface: string;
  grid: string;
  axis: string;
  /** Estados (reservados: no se usan como serie). Siempre van con ícono y texto. */
  warning: string;
  critical: string;
}

const DARK: ChartColors = {
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
  other: '#898781',
  surface: '#0f172a',
  grid: 'rgba(255,255,255,0.08)',
  axis: '#898781',
  warning: '#fab219',
  critical: '#d03b3b',
};

const LIGHT: ChartColors = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
  other: '#898781',
  surface: '#ffffff',
  grid: '#e2e8f0',
  axis: '#64748b',
  warning: '#fab219',
  critical: '#d03b3b',
};

export const chartColors = (theme: ResolvedTheme): ChartColors => (theme === 'dark' ? DARK : LIGHT);
