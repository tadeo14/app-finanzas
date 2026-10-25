// Colores de los gráficos. La paleta categórica (pasos oscuros) se validó con el validador de dataviz contra
// la superficie de las tarjetas (#0f172a): banda de luminosidad, croma, separación para daltonismo,
// piso en visión normal y contraste >= 3:1. El orden es fijo: nunca se cicla ni se generan tonos nuevos.
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'] as const;
/** "Otros" y todo lo que no es una serie con nombre. */
export const OTHER = '#898781';
export const SURFACE = '#0f172a';
export const GRID = 'rgba(255,255,255,0.08)';
export const AXIS = '#898781';
export const INK = '#f1f5f9';
/** Estados (reservados: no se usan como serie). Siempre van con ícono y texto. */
export const STATUS = { warning: '#fab219', critical: '#d03b3b' } as const;
