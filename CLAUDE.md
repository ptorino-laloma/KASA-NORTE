# CLAUDE.md

## Qué es esto
Kasa Norte: sistema de gestión para un emprendimiento de comida casera (empanadas,
guisos, tartas, pastas...). Una parte se produce (con receta y costo propio) y otra
se compra hecha y se revende (sorrentinos, ñoquis). Reemplaza la planilla
"KASA NORTE" de Google Sheets, que se rompía y no se actualizaba sola. La usa una
sola persona (la dueña), mayormente desde el celular.

Misma arquitectura que **Casa-Tafi** (`ptorino-laloma/Casa-Tafi`): Node sin
dependencias, datos en **Google Sheets**, deploy en **Vercel**.

**Antes de tocar nada, leé `estado.md`.** Tiene las reglas de negocio, la
migración desde la planilla vieja, lo pendiente y la deuda técnica.

## Cómo correrlo (local)
```
node server/index.js      # http://localhost:3000
npm test                  # node scripts/test.js
```
Sin configurar nada, los datos van a `data/kasa.json` y se entra con cualquier
clave. Para usar la planilla real, copiar `.env.example` a `.env`.

## Estructura
```
api/handler.js        función serverless de Vercel (reconstruye la ruta y llama a app.js)
server/
  app.js              ruteo de /api/*, sesión, y qué tablas escribe cada ruta
  routes.js           lógica de cada endpoint sobre el "state" en memoria, con validaciones
  importer.js         importación única desde las pestañas viejas (función pura)
  store.js            elige backend (Sheets o archivo) + seed de categorías de gasto
  store-sheets.js     backend Google Sheets (una pestaña "App ..." por tabla, JWT con node:crypto)
  store-file.js       backend de desarrollo (data/kasa.json)
  auth.js             usuario/clave de entorno + cookie firmada (HMAC)
  lib.js              uid, ApiError, validadores, normName, constantes
  index.js            servidor HTTP local
public/
  index.html          HTML + CSS (sin build)
  app.js              UI (sin frameworks)
  calc.js             TODOS los cálculos del negocio; lo usan el navegador y el servidor
  sw.js, manifest     PWA instalable
  fonts/              Cabin (textos, del brand book) + League Spartan (títulos), woff2 OFL
  brand/              logo-crema.png e isotipo.png sacados del brand book (PDF)
scripts/
  test.js             pruebas sin dependencias
  exportar-planilla-vieja.py  (dev) xlsx → data/planilla-vieja.json para probar la importación
```

## Decisiones de arquitectura a respetar
- **Cero dependencias npm, a propósito.** La API de Google se llama con `fetch`.
- **Los cálculos viven en un solo lugar: `public/calc.js`** (costo por receta,
  stock, estado de resultados, rentabilidad). El servidor lo `require`-a para
  congelar el costo al registrar ventas y producción. No dupliques esa lógica.
- **`GET /api/state` devuelve todo**; cada mutación devuelve `{..., state}` con el
  state completo actualizado y el frontend lo usa directo (no hace otro GET).
- **Cada ruta que escribe declara sus tablas** en `ROUTES` (`server/app.js`); si
  no, no se persiste.
- **Formato en Sheets**: `SHEETS` en `server/store-sheets.js`. Campos nuevos,
  **al final** de `headers`. Las pestañas viejas de la planilla no se tocan nunca.
- **El repo es público**: nada de datos del negocio (clientes, montos, la
  planilla) ni claves. `data/*.json`, `*.xlsx`, `.env` están en `.gitignore`. Las
  pruebas usan datos inventados.
- Los ids los genera el servidor (`uid()`).
- **Marca** (brand book de Kasa Norte): colores en `:root` de `index.html`; fuentes
  locales (no Google Fonts); logo e isotipo como PNG en `public/brand/`. Íconos de
  la PWA = isotipo crema sobre bordó (`public/icons/`).

## Reglas de negocio que no hay que romper sin querer (detalle en `estado.md`)
- Costo por unidad = Σ(cantidad × precio actual del insumo) / rinde. Sin receta o
  sin rinde → costo `null` (no se inventa). Insumo sin precio → cuenta $0 con aviso.
- Ventas y producción **congelan** el costo unitario del momento (`costoUnit`).
  Cambiar un precio de insumo no reescribe el pasado; al editar una venta se
  respeta el costo congelado de los productos que ya tenía.
- Stock = producido − vendido + ajustes. Siempre calculado, nunca guardado.
- Resultados: "Resultado" (ventas − egresos) y "margen teórico" (receta) se
  muestran por separado y **no se restan entre sí** (las recetas ya incluyen
  horas de trabajo y luz/gas).

## Antes de dar por terminada una tarea
1. `node --check` sobre lo que toques y `npm test`.
2. Si tocás la UI, levantala y probala (hay un recorrido con Playwright descripto
   en `estado.md` § Cómo se verificó).
3. Actualizá `estado.md`.
