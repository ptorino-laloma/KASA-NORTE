// Capa de persistencia. El resto del server trabaja con un objeto "state" en
// memoria (forma de abajo) y le pide al store que lo cargue y lo guarde.
//
//   insumos:         [{ id, nombre, unidad, costo, actualizado, notas }]
//   productos:       [{ id, nombre, categoria, tipo: 'propio'|'reventa', unidad, rinde, precio,
//                       precioMayorista, recargo, activo, stockMinimo, notas }]
//   recetas:         [{ id, productoId, insumoId, cantidad }]   (una fila por insumo de la receta)
//   producciones:    [{ id, fecha, productoId, cantidad, costoUnit, nota, creado }]
//   ventas:          [{ id, fecha, clienteId, total, estadoPago, medioPago, nota, creado }]
//   ventaItems:      [{ id, ventaId, productoId, cantidad, precioUnit, costoUnit }]
//   gastos:          [{ id, fecha, categoria, monto, medioPago, estadoPago, proveedor, nota, creado }]
//   ajustes:         [{ id, fecha, productoId, cantidad (+/-), motivo, nota, creado }]
//   clientes:        [{ id, nombre, tipo, telefono, notas }]
//   categoriasGasto: [{ nombre, grupo }]
//
// Backend según entorno:
//   - GOOGLE_SHEET_ID definido → Google Sheets (producción, ver store-sheets.js)
//   - si no → archivo JSON local en data/kasa.json (desarrollo, cero configuración)
//
// save(state, tables) recibe la lista de tablas que cambiaron, para que el
// backend de Sheets reescriba solo esas pestañas.

const { DEFAULT_CATEGORIAS_GASTO, ApiError } = require('./lib.js');

// En Vercel el disco no persiste: sin planilla configurada, mejor fallar claro
// que "guardar" en un archivo que se pierde a los minutos.
const backend = process.env.GOOGLE_SHEET_ID
  ? require('./store-sheets.js')
  : process.env.VERCEL
    ? { name: 'sin configurar', load: noSheet, save: noSheet, readRaw: noSheet }
    : require('./store-file.js');

function noSheet() {
  throw new ApiError(500, 'Falta configurar la planilla de Google (GOOGLE_SHEET_ID y GOOGLE_SERVICE_ACCOUNT_JSON) en Vercel.');
}

const TABLES = ['insumos', 'productos', 'recetas', 'producciones', 'ventas', 'ventaItems', 'gastos', 'ajustes', 'clientes', 'categoriasGasto'];

function emptyState() {
  const s = {};
  TABLES.forEach(t => { s[t] = []; });
  return s;
}

async function load() {
  const state = Object.assign(emptyState(), await backend.load());
  // Seed inicial: la primera vez no hay categorías de gasto.
  if (!state.categoriasGasto.length) {
    state.categoriasGasto = DEFAULT_CATEGORIAS_GASTO.map(c => ({ ...c }));
    await backend.save(state, ['categoriasGasto']);
  }
  return state;
}

async function save(state, tables) {
  await backend.save(state, tables);
}

async function readRaw(titles) {
  return backend.readRaw(titles);
}

module.exports = { load, save, readRaw, TABLES, backendName: backend.name };
