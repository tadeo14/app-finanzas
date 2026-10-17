# Finanzas Personales

App web personal de finanzas con foco en tarjetas de crédito y compras en cuotas (Argentina).
Corre 100% en el navegador (IndexedDB vía Dexie), instalable como PWA y funciona offline.

## Desarrollo

```bash
npm install
npm run dev      # servidor local
npm run test     # tests de dominio (Vitest)
npm run build    # typecheck + build de producción en dist/
```

## Estructura

```
src/
  domain/   lógica pura (dinero, fechas, tarjetas…) + tests
  db/       schema Dexie y seed
  hooks/    wrappers de useLiveQuery
  components/
  pages/    Inicio, Movimientos, Tarjetas, Reportes, Más
```

Reglas: montos en centavos enteros, fechas como `YYYY-MM-DD`, lógica de dominio sin React ni Dexie.
