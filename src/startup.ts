// Resultado de lo que corre al abrir la app, para avisarle al usuario.
export interface StartupResult {
  /** Movimientos y compras creados por los recurrentes. */
  generated: number;
  failures: { description: string; message: string }[];
}

export const startup: StartupResult = { generated: 0, failures: [] };
