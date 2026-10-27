# Finanzas Personales

App web personal de finanzas, pensada para el celular y para el contexto argentino: **tarjetas de crédito y compras en cuotas**, cuentas en pesos y dólares, presupuestos y reportes.

Corre 100 % en el navegador: no hay servidor, ni cuenta, ni costos. Los datos viven en el dispositivo y se respaldan con un archivo.

## Qué hace

- **Cuentas y movimientos**: gastos, ingresos y transferencias entre cuentas (también entre monedas, por ejemplo la compra de dólares). Saldos siempre al día.
- **Tarjetas como en Mobills**: cada compra cae en el resumen que corresponde según la fecha de cierre y las cuotas se reparten solas en los resúmenes siguientes. Se pueden editar el cierre y el vencimiento de cualquier resumen (los bancos los mueven mes a mes) y las compras se reubican solas.
- **Cuotas**: con o sin interés, compras que ya venías pagando, devoluciones, adelanto de cuotas y vista de cuánto debés en los próximos 12 meses.
- **Pago de resúmenes**: total o parcial, en pesos y en dólares (desde una cuenta en dólares o con pesos a una cotización). El saldo vencido se arrastra al resumen siguiente.
- **Presupuestos** por categoría (para todos los meses o para uno puntual) con alerta al 80 % y al 100 %.
- **Reportes**: gastos por categoría con detalle de subcategorías y evolución mensual de ingresos contra gastos.
- **Recurrentes**: gastos fijos, ingresos y suscripciones (incluso con tarjeta) que se cargan solos al abrir la app.
- **Importar movimientos** desde un CSV (una planilla o el extracto de tu banco): detecta las columnas, muestra una vista previa con los errores y los que ya existen, y se puede deshacer.
- **Backup**: exportar todo a JSON, importar (con validación completa antes de reemplazar), exportar movimientos a CSV y recordatorio si pasaron más de 15 días.
- **Modo claro y oscuro** (automático según el dispositivo, o a elección) e **instalable** como app, también sin conexión.

## Importar una lista de movimientos

*Más → Importar movimientos* carga de una vez una lista de gastos e ingresos desde un archivo **CSV** (si tenés un Excel, guardalo como CSV). Suma movimientos: no borra ni cambia los que ya tenés.

- **Columnas**: se reconocen por el encabezado (Fecha, Descripción, Monto, Categoría, Cuenta, Tipo, Moneda…) y, si no hay encabezado, por el contenido. Se pueden corregir a mano. Sirven tanto una columna de monto (negativo = gasto) como columnas separadas de Débito y Crédito, o una columna de Tipo.
- **Formatos**: separador `;`, `,`, tabulación o `|`; fechas `15/10/2026`, `2026-10-15` o `10/15/2026`; montos `1.234,56`, `1,234.56`, `$ 1.000`, `(500)`, `500-`.
- **Vista previa** antes de guardar: cuántos entran, cuáles tienen error (con el número de línea y el motivo) y cuáles ya existen.
- **Sin duplicados**: un movimiento igual a uno que ya está (misma cuenta, tipo, día, monto y descripción) se saltea, así que reimportar el mismo archivo no agrega nada.
- **Categorías**: se asocian por nombre (también `Comida > Supermercado`); las que no existen se pueden crear.
- **Deshacer**: al terminar se puede deshacer toda la importación.
- No se importan las transferencias ni las cuotas de tarjeta (se cargan desde el botón +). El CSV que exporta la propia app se puede volver a importar.

## Tus datos

Todo se guarda en el almacenamiento del navegador (IndexedDB) de **este dispositivo**. No se envía nada a ningún servidor.

Eso tiene una consecuencia: si borrás los datos del navegador, desinstalás la app o perdés el celular, **solo un backup te permite recuperar todo**. Exportá uno desde *Más → Backup* de vez en cuando; la app te lo recuerda a los 15 días. El archivo sirve también para pasar tus datos a otro dispositivo (importándolo allá).

## Instalarla en el celular

Abrí la dirección donde esté publicada:

- **Android (Chrome)**: menú ⋮ → *Instalar app* (o *Agregar a la pantalla principal*).
- **iPhone (Safari)**: botón Compartir → *Agregar a pantalla de inicio*.

Una vez instalada funciona sin conexión. En Android, al mantener apretado el ícono aparecen atajos a *Nuevo gasto* y *Compra con tarjeta*.

## Desarrollo

Requiere Node 20 o más nuevo.

```bash
npm install
npm run dev      # servidor local con recarga
npm run test     # tests de la lógica (Vitest)
npm run build    # revisa los tipos y genera la app en dist/
npm run preview  # sirve dist/ para probar la versión de producción (y la PWA)
```

### Cómo está organizado

```
src/
  domain/      lógica pura (dinero, fechas, cuotas, pagos, reportes, backup…) con sus tests; sin React ni base de datos
  db/          base local (Dexie): esquema, escrituras con validación, backup y sus tests
  hooks/       lecturas reactivas de la base
  components/  piezas de interfaz reutilizables
  pages/       una por pantalla
public/        íconos y archivos estáticos
scripts/       generador de los íconos PNG
```

### Reglas de diseño

1. **Los montos son enteros en centavos.** Nunca se usan decimales para dinero; se formatea (`$ 1.234,56`) solo al mostrar.
2. **Las fechas son texto `AAAA-MM-DD`** (fecha local, sin hora) y los períodos `AAAA-MM`. Se evita `new Date('AAAA-MM-DD')` porque corre el día según la zona horaria.
3. **Toda la lógica está en funciones puras** en `src/domain/`, testeadas sin navegador. La capa `db/` solo lee y escribe.
4. Las cuotas se generan a partir de la compra y se guardan; editar la compra las regenera. En modo "monto total" el resto del redondeo va a la primera cuota, así la suma da exacta.
5. Una compra cae en el **primer resumen cuyo cierre es igual o posterior** a la fecha de compra (el día del cierre entra en ese resumen).
6. Los gastos con tarjeta se cuentan en el mes del resumen donde cae cada cuota; el pago del resumen **no** es un gasto (ya se contó en las cuotas).

### Tests

`npm run test` cubre la lógica de dominio y la persistencia (con una IndexedDB simulada): cierres en meses cortos y años bisiestos, reparto de cuotas, adelantos, pagos repartidos entre resúmenes, saldo arrastrado, recurrentes, validación e importación de backups, migración del esquema, etc.

## Publicarla (gratis)

La app es un sitio estático: alcanza con cualquier hosting estático. Hay que redirigir todas las rutas a `index.html` (para que abrir `/tarjetas/…` directamente funcione); ya está configurado para Vercel y Netlify.

### Vercel

1. Subí el proyecto a GitHub.
2. En [vercel.com](https://vercel.com) → *Add New… → Project* → importá el repositorio.
3. Vercel detecta Vite solo. Los valores que usa (están en `vercel.json`):
   - **Build command**: `npm run build`
   - **Output directory**: `dist`
4. *Deploy*. Cada `git push` a `main` publica una versión nueva.

Con la línea de comandos: `npx vercel` (prueba) y `npx vercel --prod` (producción).

### Netlify

1. En [netlify.com](https://netlify.com) → *Add new site → Import an existing project* → elegí el repositorio.
2. **Build command**: `npm run build`, **Publish directory**: `dist`.
3. *Deploy*. La regla de redirección está en `public/_redirects`.

También se puede arrastrar la carpeta `dist/` (después de `npm run build`) a [app.netlify.com/drop](https://app.netlify.com/drop).

### Importante al publicar

- Necesita **HTTPS** (Vercel y Netlify lo dan) para poder instalarse y funcionar sin conexión.
- Cada dirección tiene **sus propios datos**: lo que cargues en `localhost` o en una versión de prueba no aparece en la publicada. Para pasarlo, exportá un backup e importalo.
- La app se actualiza sola: al abrirla con conexión descarga la versión nueva.
- Si cambia la estructura de los datos, el esquema de la base está versionado (`src/db/schema.ts`) y se migra solo al abrir; hay un test que lo verifica.

## Limitaciones conocidas

- Un solo usuario y un solo dispositivo por vez: no hay sincronización. Para cambiar de dispositivo, exportá e importá un backup.
- Sin conexión con el banco: los movimientos se cargan a mano.
- La cotización del dólar es un valor de referencia que se carga a mano; cada pago de tarjeta en dólares usa su propia cotización.
- Se probó en Chromium (con tamaño de celular). No se probó todavía en Safari/iPhone ni en Firefox: si algo se ve o se comporta distinto ahí, avisá.
