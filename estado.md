# Estado del proyecto — Kasa Norte

Última actualización: 2026-09-30 (v2: datos maestros, recetario, panel de control, marca).

## 1. Qué es
App web (instalable en el celular) para llevar el negocio de comida de Kasa Norte:
ventas, egresos, producción, stock automático, costeo por receta, panel de
control y estado de resultados. Reemplaza la planilla de Google "KASA NORTE" y usa
esa misma planilla como base de datos (pestañas nuevas "App ...").

## 2. Pantallas
(v3: el Panel es la pantalla de inicio; se sacaron Inicio y Configuración.)
- **Panel** (período: este mes, mes anterior, este año, año anterior o fechas a
  elección; comparación: período anterior o mismo período del año anterior):
  - *Resumen*: tarjetas (ventas, egresos, resultado, margen de lo vendido, venta
    promedio, por cobrar, stock a precio de venta vs. costo) con variación,
    "Para mirar" (alertas) y lo más vendido. Muestra una vez el resultado de la
    migración automática.
  - *Ventas*: tabla agrupable por producto, familia, cliente, tipo de cliente y
    mes (combinables), grupos que se abren, filtro, exportar a Excel (CSV).
  - *Costos*: costo productivo total con chips Por insumo / Por producto terminado.
  - *Resultados*: tarjetas con variación, gráfico de tendencia, estado de
    resultados vertical y tabla mes a mes.
- **Ingresos** → *Ventas* y *Otros ingresos* (lo que entra y no es venta).
- **Egresos**: categoría, monto, medio, estado, proveedor, detalle. **Detalle de
  compra opcional** (insumo, cantidad, precio): suma al stock de insumos, el monto
  pasa a ser la suma, y con la casilla tildada actualiza el precio de cada insumo.
- **Producción**: cantidad en unidad de venta; congela costo y descuenta los
  insumos de la receta.
- **Stock** → *Productos terminados* y *Insumos* (comprado − usado ± ajustes,
  mínimo editable, conteo físico y ajustes). La familia "Mano de obra y
  servicios" no lleva stock.
- **Recetario**: unidad de venta, rinde, insumos y costo en vivo; copiar receta.
- **Datos maestros**: Productos, Insumos (con "Proponer familias"), Clientes,
  Familias y **Categorías de egresos** (antes en Configuración).

Glosario de las tarjetas:
- **Margen de lo vendido** (antes "margen teórico"): (precio − costo de receta) /
  precio, sobre lo vendido con productos cargados en el período.
- **Venta promedio** (antes "ticket promedio"): ventas del período / cantidad de ventas.
- **Stock a precio de venta**: stock positivo de productos × precio; "dejaría" =
  eso menos su costo de receta.

### Marca
Colores tomados del logo y los posts de Instagram (bordó `#6B0512`, rojo
`#8F0E11`, crema `#F0DDD3`, mostaza `#DBA443`, oliva `#78833E`, fondo `#F6EFEB`).
Tipografías servidas desde la app (`public/fonts/`, licencia OFL): League Spartan
(la más parecida en Google Fonts a la del logo; **la original no está
identificada**) y Figtree. El logo del encabezado está redibujado en vectores
(letras convertidas a trazos, tomate a mano) porque solo había una captura de
baja resolución; si aparece el archivo original, reemplazarlo. `public/logo.svg`
es la versión suelta. Colores del gráfico validados para daltonismo con el
validador de la guía de visualización.

## 3. Reglas de negocio
### 3.1 Costeo
- Cada producto tiene receta = insumos y cantidades **para una tanda**, y un
  **rinde** = unidades de venta que salen de esa tanda (ej. 10 docenas).
- Costo unitario = Σ(cantidad × precio actual del insumo) / rinde. La cantidad va
  en la unidad del insumo (si el insumo está en KG, 30 gramos = 0,03).
- Horas de trabajo y luz/gas se cargan como insumos (así lo hacía la planilla).
- Precio sugerido = costo × (1 + recargo). Recargo por defecto 100%.
- Margen = (precio − costo) / precio. Markup = (precio − costo) / costo (la
  "Rentabilidad" de la planilla vieja).
- **Reventa** (tercerizado): la "receta" es lo que se compra (ej. 1 caja de
  sorrentinos) y el rinde, cuántas unidades se venden de eso.

### 3.2 Costo congelado
Ventas (`ventaItems.costoUnit`) y producción (`producciones.costoUnit`) guardan el
costo del momento. Al editar una venta se mantiene el costo de los productos que
ya tenía. Así la rentabilidad de meses pasados no cambia cuando sube un insumo.

### 3.3 Stock
Stock = producido − vendido + ajustes. Nunca se guarda, se calcula. Una venta
sin productos (solo monto) no descuenta stock.

### 3.4 Resultados
- **Resultado** = ventas − egresos cargados. Es la plata real.
- **Margen teórico** = ingresos de ventas con productos − su costo congelado.
- No se mezclan: las recetas ya incluyen horas y luz/gas, y las compras de
  insumos ya están en egresos. Restar ambas cosas contaría todo dos veces.
- Grupos de egresos (se editan en Configuración): Mercadería (Carnicería,
  Verdulería, Súper, Masas, Congelados, Descartable), Fijos (Empleada, Sueldo
  Popi, Monotributo), Otros (Varios y las nuevas). Esta clasificación es una
  propuesta inicial; confirmarla con la dueña.

### 3.5 Familias y otros ingresos
- Productos (`categoria`) e insumos (`familia`) solo pueden usar familias que
  existan en Datos maestros → Familias (lo valida el servidor).
- Otros ingresos no son ventas: no entran en ventas, ticket ni margen; se suman
  en "Resultado final".
- Panel → Costos: el total por producto es el costo congelado de cada
  producción; la apertura por insumo reparte ese total según la receta **actual**
  (la suma cierra igual). Producciones sin costo no suman y se avisa.

### 3.6 Stock de insumos
- Stock = comprado (detalle de compra de egresos) − consumido (producciones) + ajustes.
- Cada producción guarda en `consumo` lo que descontó (tandas × receta de ese
  momento). Las producciones importadas no tienen `consumo`: la planilla vieja no
  tenía compras por insumo, así que el stock de insumos arranca con un conteo.
- Editar un egreso no vuelve a tocar precios salvo que se tilde la casilla.

### 3.7 "Para mirar" (alertas automáticas, `Calc.alertas`)
Se recalculan con cada cambio. Urgentes: cobros pendientes (con "marcar cobrada"),
pagos a realizar (con "marcar pagado"), productos por quedarse sin stock (stock ≤ 0
con ventas recientes, o que alcanza para menos de 7 días al ritmo de los últimos
30, o bajo el mínimo), insumos para reponer (solo los que ya tienen compra con
detalle o conteo) y productos activos sin ventas hace 30+ días. Aparte, plegado,
"Datos para completar o revisar". Constantes en `calc.js` (DIAS_SIN_VENTA,
DIAS_COBERTURA, VENTANA_RITMO).

### 3.8 Clientes repetidos y ventas que no eran ventas
- `Calc.clientesParecidos`: mismas palabras en otro orden, escritura casi igual,
  mismo nombre con apellido parecido, o nombre incompleto. No marca parientes.
  En Datos maestros → Clientes: "Dejar «X»" une (las ventas pasan a X) o "No son la
  misma" (se recuerda en ese dispositivo).
- Ventas sin productos tienen "A otros ingresos" (ej. devolución de un préstamo).

### 3.9 Migración automática
Al abrir la app (GET /api/state) con la base vacía (sin insumos, productos,
producciones, ventas, egresos, clientes ni otros ingresos) se importan solas las
pestañas viejas y se guarda todo. Si no existen, no hace nada. Ya no hay botón.

### 3.10 Ingreso
Un solo usuario: `APP_USUARIO` (default "kasa") + `APP_CLAVE`, cookie firmada de
60 días. En Vercel `APP_CLAVE` y `SESSION_SECRET` son obligatorias (el repo es
público; un secreto por defecto permitiría fabricar cookies). Un login fallido
tarda 0,8 s. No hay bloqueo por intentos.

- Los valores de `APP_USUARIO`, `APP_CLAVE` y `SESSION_SECRET` se limpian de espacios
  y comillas alrededor (error común al pegarlos en Vercel). La clave tipeada se
  compara sin espacios en los extremos; el usuario, sin distinguir mayúsculas.
- `GET /api/diagnostico` (público) dice qué variables están cargadas, sin mostrar
  valores: usuario configurado, si hay clave, si la clave tenía comillas/espacios,
  si hay SESSION_SECRET, planilla y el `client_email` de la cuenta de servicio.

## 4. Migración desde la planilla vieja
Automática la primera vez (ver 3.7); el resumen y los avisos se muestran una vez
en Panel → Resumen. Lee COSTOS, PRODUCCION, INGRESOS Y EGRESOS,
CLIENTES y Base de datos **sin modificarlas**. Columnas ubicadas por encabezado.

Probado con un export del 2026-09-30 (datos ene–ago 2026):
71 insumos, 44 productos, 328 renglones de receta, 60 producciones, 276 ventas
(286 renglones con producto), 223 gastos, 4 ajustes, 184 clientes.
**Totales de ventas y egresos iguales al peso a los de la planilla** (sin el
egreso sin fecha de abajo). Los montos no se anotan acá porque el repo es público.

Decisiones:
- Renglones seguidos del mismo cliente, fecha, estado y medio → una venta.
- Monto de cada renglón = total del renglón → precio unitario = monto / cantidad.
- Ingresos sin producto (casi todos desde mayo 2026): venta sin detalle (solo
  total). Cuentan para la caja, no para stock ni rentabilidad por producto.
- Ingresos sin estado de pago → cobrados (así sumaba la planilla).
- Autoconsumo sin monto → ajuste de stock negativo, no venta.
- Costo congelado de lo importado = costo con los precios de insumos **de hoy**
  (la planilla no guardaba el costo histórico) → rentabilidad histórica aproximada.
- La app usa siempre el precio de la lista de insumos, aunque en alguna receta la
  planilla tuviera otro número escrito a mano.
- Reventa detectada si la receta es un solo insumo con el mismo nombre del producto.
- Familia de insumo propuesta por palabra clave con las mismas reglas del botón
  (la planilla no la tenía). Con los datos reales clasifica los 71 insumos; se
  revisa en Datos maestros → Insumos.
- Unidad de venta por categoría (Empanadas → docena, Pastas → caja, Pizzas y
  hamburguesas → unidad, resto → porción). Se cambia en el editor.
- Nombres unificados sin distinguir mayúsculas/acentos/espacios dobles, más dos
  typos conocidos (`ALIAS` en `server/importer.js`).

Lo que se encontró en la planilla (a revisar con la dueña):
- **Empanada de QyC**: la planilla subestimaba el costo porque un renglón decía
  "Empanada  de QyC" (doble espacio) y no sumaba la muzzarella a la receta.
- **PRODUCCION → "Costo"** multiplicaba por el *precio de venta sugerido*, no por
  el costo. En la app la producción se valoriza al costo.
- Recetas con precio escrito a mano distinto de la lista: Zanahoria en Cazuela de
  Pollo y Pollo en Empanada Pollo.
- 5 tandas de producción con fecha **dic-2026** (futuro): parecen dic-2025. Se
  importan tal cual.
- 11 productos sin costo: copetines (sin rinde; y las recetas de copetín JyQ,
  berenjena, remolacha y humita tienen cantidades de masa que no cierran, ej. 473
  masas), "Empanada" genérica y Arrollado de pollo (sin receta).
- Wraps y copetines sin precio de venta.
- **Julio 2026**: todos los egresos están cargados como "Varios" → el estado de
  resultados no puede separar mercadería de fijos ese mes. "Varios" es la
  categoría más grande del año: conviene usar categorías más finas.
- **Hamburguesa de carne**: una venta de abril figura por debajo del costo
  unitario → el producto aparece a pérdida en el año. Puede ser un error de carga
  (¿unidades en vez de packs?).
- Stock histórico con muchos negativos (ventas sin producción cargada), igual que
  la pestaña STOCK vieja. **Hacer un conteo físico** al empezar a usar la app.
- Faltantes que se saltean: un egreso de "Empleada" sin fecha, un egreso sin
  monto, un ingreso sin producto ni monto. 14 renglones de venta sin monto → $0.
- Las pestañas FACTURACION 2022–2025 y GANANCIAS (ocultas, con otro formato) **no**
  se importan. Quedan en la planilla.

## 5. Infraestructura
- Repo: `github.com/ptorino-laloma/KASA-NORTE` (**público**).
- Planilla: "KASA NORTE" de Google (copia nativa creada el 2026-09-30, dueño
  Pablo; el id va en `GOOGLE_SHEET_ID`, no en el repo). Hay también un
  `KASA NORTE.xlsx` en el Drive: la API de Sheets no puede usar xlsx.
- Vercel: a desplegar en la cuenta personal de Pablo (`blop4`), como Casa-Tafi.
  Variables: `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `APP_USUARIO`,
  `APP_CLAVE`, `SESSION_SECRET`. La planilla tiene que estar compartida como Editor
  con el `client_email` de la cuenta de servicio.

## 6. Cómo se verificó (2026-09-30)
- `npm test`: 16 pruebas (v2 agrega familias, maestros vs recetario, otros ingresos, rangos de comparación, agrupado de ventas y costos por insumo/producto). Las 10 originales: (costeo, costo congelado, stock y conteo, resumen,
  validaciones, clientes, categorías, importación de ejemplo + real local).
- Servidor local con backend de archivo: login (clave mala → 401), vista previa e
  importación por API, segunda importación rechazada.
- Recorrido con Chromium headless (390 px y 1280 px): todas las pestañas sin
  errores de JS; venta descuenta stock; producción suma; cambio de precio de un
  insumo recalcula costos; editor guarda; conteo deja el stock en el valor real;
  cambio cobrada/pendiente.
- **No probado todavía contra Google Sheets real** (no había credenciales de la
  cuenta de servicio en esta sesión). El backend de Sheets es el de Casa-Tafi con
  otras pestañas, más `readRaw` para la importación.

- v2 (2026-09-30): recorrido con Chromium en 390 px y 1280 px de Panel (ventas agrupadas,
  detalle, exportación CSV, costos por insumo/producto, resultados con comparación y
  gráfico), Recetario, Datos maestros (usar sugerido, familia de insumo), otros
  ingresos, producción con costo. Sin errores de JS.

## 7. Pendientes / ideas
- Deploy en Vercel + compartir la planilla con la cuenta de servicio + importar.
- Reemplazar el logo redibujado por el archivo original si aparece.
- Conteo físico inicial de stock.
- Stock de **insumos** (hoy solo de productos terminados). Requiere cargar las
  compras con cantidades, no solo "Verdulería $X".
- Pedidos a futuro / agenda de entregas; combos (Box familiar) como producto
  compuesto.
- Exportar resultados (PDF/Excel).

## 8. Deuda técnica (honesta)
- Cada request lee todas las pestañas "App" y reescribe completas las que cambian.
  Para una usuaria y unos miles de filas alcanza. Si crece mucho, pasar a
  escrituras por fila.
- Sin control de concurrencia: si se guarda desde dos dispositivos exactamente a
  la vez, gana el último.
- Sin test de la UI automatizado en el repo (el recorrido de Playwright se hizo a
  mano en la sesión).
