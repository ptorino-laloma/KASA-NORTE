// Capa de persistencia. El resto del server trabaja con un objeto "state" en
// memoria (forma de abajo) y le pide al store que lo cargue y lo guarde.
//
//   insumos:         [{ id, nombre, familia, unidad, costo, actualizado, notas }]
//   productos:       [{ id, nombre, categoria (= familia), tipo: 'propio'|'reventa', unidad, rinde, precio,
//                       precioMayorista, recargo, activo, stockMinimo, notas }]
//   recetas:         [{ id, productoId, insumoId, cantidad }]   (una fila por insumo de la receta)
//   producciones:    [{ id, fecha, productoId, cantidad, costoUnit, nota, creado }]
//   ventas:          [{ id, fecha, clienteId, total, estadoPago, medioPago, nota, creado }]
//   ventaItems:      [{ id, ventaId, productoId, cantidad, precioUnit, costoUnit }]
//   gastos:          [{ id, fecha, categoria, monto, medioPago, estadoPago, proveedor, nota, creado }]
//   ajustes:         [{ id, fecha, productoId, cantidad (+/-), motivo, nota, creado }]
//   clientes:        [{ id, nombre, tipo, telefono, notas }]
//   categoriasGasto: [{ nombre, grupo }]
//   familias:        [{ nombre, tipo: 'producto'|'insumo' }]
//   otrosIngresos:   [{ id, fecha, concepto, monto, medioPago, nota, creado }]   (lo que entra y no es venta)
//
// Backend según entorno:
//   - GOOGLE_SHEET_ID definido → Google Sheets (producción, ver store-sheets.js)
//   - si no → archivo JSON local en data/kasa.json (desarrollo, cero configuración)
//
// save(state, tables) recibe la lista de tablas que cambiaron, para que el
// backend de Sheets reescriba solo esas pestañas.

const { DEFAULT_CATEGORIAS_GASTO, DEFAULT_FAMILIAS_INSUMO, ApiError } = require('./lib.js');

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

const TABLES = ['insumos', 'productos', 'recetas', 'producciones', 'ventas', 'ventaItems', 'gastos', 'ajustes', 'clientes', 'categoriasGasto', 'familias', 'otrosIngresos'];

function emptyState() {
  const s = {};
  TABLES.forEach(t => { s[t] = []; });
  return s;
}

async function load() {
  const state = Object.assign(emptyState(), await backend.load());
  // Seed inicial: la primera vez no hay categorías de gasto.
  const seeded = [];
  if (!state.categoriasGasto.length) {
    state.categoriasGasto = DEFAULT_CATEGORIAS_GASTO.map(c => ({ ...c }));
    seeded.push('categoriasGasto');
  }
  // Familias: la primera vez salen de las categorías que ya tengan los productos
  // (y los insumos) más las familias de insumo por defecto.
  if (!state.familias.length) {
    state.familias = familiasIniciales(state);
    seeded.push('familias');
  }
  if (seeded.length) await backend.save(state, seeded);
  return state;
}

function familiasIniciales(state) {
  const out = [];
  const add = (nombre, tipo) => {
    if (nombre && !out.some(f => f.tipo === tipo && f.nombre === nombre)) out.push({ nombre, tipo });
  };
  state.productos.forEach(p => add(p.categoria, 'producto'));
  state.insumos.forEach(i => add(i.familia, 'insumo'));
  DEFAULT_FAMILIAS_INSUMO.forEach(n => add(n, 'insumo'));
  return out;
}

async function save(state, tables) {
  await backend.save(state, tables);
}

async function readRaw(titles) {
  return backend.readRaw(titles);
}

module.exports = { load, save, readRaw, TABLES, familiasIniciales, backendName: backend.name };
