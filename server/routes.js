// Lógica de cada endpoint sobre el "state" en memoria, con validaciones.
// Los handlers modifican el state; app.js guarda las tablas declaradas y devuelve
// el state completo actualizado (así el frontend no necesita otro GET).
const Calc = require('../public/calc.js');
const {
  uid, ApiError, reqDate, reqText, optText, reqNum, optNum, oneOf, normName,
  GRUPOS_GASTO, MEDIOS_PAGO, ESTADOS_PAGO, TIPOS_PRODUCTO, TIPOS_CLIENTE, TIPOS_FAMILIA
} = require('./lib.js');

const MOTIVOS_AJUSTE = ['Conteo', 'Merma', 'Autoconsumo', 'Regalo', 'Otro'];

const now = () => new Date().toISOString();
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

function find(list, id, que) {
  const x = list.find(e => e.id === id);
  if (!x) throw new ApiError(404, `No encontré ${que}.`);
  return x;
}

function remove(list, id, que) {
  const i = list.findIndex(e => e.id === id);
  if (i < 0) throw new ApiError(404, `No encontré ${que}.`);
  list.splice(i, 1);
}

function checkUnico(list, nombre, exceptId, que) {
  const k = normName(nombre);
  if (list.some(x => x.id !== exceptId && normName(x.nombre) === k)) throw new ApiError(400, `Ya existe ${que} con ese nombre.`);
}

// Familia opcional: si viene, tiene que existir en Datos maestros → Familias.
function optFamilia(state, v, tipo) {
  const s = optText(v, 40);
  if (!s) return null;
  const f = state.familias.find(x => x.tipo === tipo && normName(x.nombre) === normName(s));
  if (!f) throw new ApiError(400, `La familia "${s}" no existe. Creala primero en Datos maestros → Familias.`);
  return f.nombre;
}

function optMedio(v) {
  return v ? oneOf(v, MEDIOS_PAGO, 'El medio de pago') : null;
}

function getState(state, session) {
  return { ...state, me: { user: session.user }, config: { hoy: hoy() } };
}

/* ---------- ventas ---------- */

// Cliente: por id, o por nombre (si no existe se crea). Vacío = venta sin cliente.
function resolverCliente(state, body) {
  if (body.clienteId) return find(state.clientes, body.clienteId, 'el cliente').id;
  const nombre = optText(body.clienteNombre, 80);
  if (!nombre) return null;
  const existente = state.clientes.find(c => normName(c.nombre) === normName(nombre));
  if (existente) return existente.id;
  const tipo = body.clienteTipo ? oneOf(body.clienteTipo, TIPOS_CLIENTE, 'El tipo de cliente') : 'Particular';
  const c = { id: uid(), nombre, tipo, telefono: null, notas: null };
  state.clientes.push(c);
  return c.id;
}

// Valida los renglones. costoPrevio: productoId → costo congelado que ya tenía la venta
// (al editar se respeta, para que un cambio de precio de insumos no reescriba el pasado).
function parseItems(state, items, costoPrevio = new Map()) {
  if (!Array.isArray(items) || !items.length) throw new ApiError(400, 'La venta tiene que tener al menos un producto.');
  if (items.length > 60) throw new ApiError(400, 'Demasiados renglones en una venta.');
  const idx = Calc.indices(state);
  return items.map(it => {
    const p = find(state.productos, it.productoId, 'el producto');
    const cantidad = reqNum(it.cantidad, `La cantidad de ${p.nombre}`);
    const precioUnit = reqNum(it.precioUnit, `El precio de ${p.nombre}`, { allowZero: true });
    const costoUnit = costoPrevio.has(p.id) ? costoPrevio.get(p.id) : Calc.costoProducto(state, p.id, idx).costoUnit;
    return { productoId: p.id, cantidad, precioUnit, costoUnit: costoUnit === null ? null : Calc.round2(costoUnit) };
  });
}

function datosVenta(state, body) {
  return {
    fecha: reqDate(body.fecha),
    estadoPago: oneOf(body.estadoPago || 'pagado', ESTADOS_PAGO, 'El estado de pago'),
    medioPago: optMedio(body.medioPago),
    nota: optText(body.nota)
  };
}

function createVenta(state, body) {
  const datos = datosVenta(state, body);
  const items = parseItems(state, body.items);
  const clienteId = resolverCliente(state, body);
  const venta = { id: uid(), ...datos, clienteId, total: Calc.round2(Calc.sum(items, i => i.cantidad * i.precioUnit)), creado: now() };
  state.ventas.push(venta);
  items.forEach(i => state.ventaItems.push({ id: uid(), ventaId: venta.id, ...i }));
  return { id: venta.id };
}

function updateVenta(state, id, body) {
  const venta = find(state.ventas, id, 'la venta');
  const datos = datosVenta(state, body);
  const previos = state.ventaItems.filter(i => i.ventaId === id);
  const costoPrevio = new Map(previos.map(i => [i.productoId, i.costoUnit]));
  const items = parseItems(state, body.items, costoPrevio);
  const clienteId = resolverCliente(state, body);
  Object.assign(venta, datos, { clienteId, total: Calc.round2(Calc.sum(items, i => i.cantidad * i.precioUnit)) });
  state.ventaItems = state.ventaItems.filter(i => i.ventaId !== id);
  items.forEach(i => state.ventaItems.push({ id: uid(), ventaId: id, ...i }));
}

function setCobro(state, id, body) {
  const venta = find(state.ventas, id, 'la venta');
  venta.estadoPago = oneOf(body.estadoPago, ESTADOS_PAGO, 'El estado de pago');
  if (body.medioPago !== undefined) venta.medioPago = optMedio(body.medioPago);
}

function deleteVenta(state, id) {
  remove(state.ventas, id, 'la venta');
  state.ventaItems = state.ventaItems.filter(i => i.ventaId !== id);
}

/* ---------- gastos ---------- */

function datosGasto(state, body) {
  const categoria = reqText(body.categoria, 'la categoría');
  if (!state.categoriasGasto.some(c => c.nombre === categoria)) throw new ApiError(400, 'Esa categoría de gasto no existe.');
  return {
    fecha: reqDate(body.fecha),
    categoria,
    monto: reqNum(body.monto, 'El monto'),
    medioPago: optMedio(body.medioPago),
    estadoPago: oneOf(body.estadoPago || 'pagado', ESTADOS_PAGO, 'El estado de pago'),
    proveedor: optText(body.proveedor, 80),
    nota: optText(body.nota)
  };
}

function createGasto(state, body) {
  const g = { id: uid(), ...datosGasto(state, body), creado: now() };
  state.gastos.push(g);
  return { id: g.id };
}

function updateGasto(state, id, body) {
  Object.assign(find(state.gastos, id, 'el gasto'), datosGasto(state, body));
}

function deleteGasto(state, id) {
  remove(state.gastos, id, 'el gasto');
}

/* ---------- producción y stock ---------- */

function createProduccion(state, body) {
  const p = find(state.productos, body.productoId, 'el producto');
  const costo = Calc.costoProducto(state, p.id).costoUnit;
  const prod = {
    id: uid(), fecha: reqDate(body.fecha), productoId: p.id,
    cantidad: reqNum(body.cantidad, 'La cantidad'),
    costoUnit: costo === null ? null : Calc.round2(costo),
    nota: optText(body.nota), creado: now()
  };
  state.producciones.push(prod);
  return { id: prod.id };
}

function deleteProduccion(state, id) {
  remove(state.producciones, id, 'la producción');
}

function createAjuste(state, body) {
  const p = find(state.productos, body.productoId, 'el producto');
  const a = {
    id: uid(), fecha: reqDate(body.fecha), productoId: p.id,
    cantidad: reqNum(body.cantidad, 'La cantidad', { allowNegative: true }),
    motivo: oneOf(body.motivo, MOTIVOS_AJUSTE, 'El motivo'),
    nota: optText(body.nota), creado: now()
  };
  state.ajustes.push(a);
  return { id: a.id };
}

// Conteo físico: para cada producto se indica cuánto hay de verdad y se genera
// un ajuste por la diferencia con el stock calculado a esa fecha.
function conteoStock(state, body) {
  const fecha = reqDate(body.fecha);
  if (!Array.isArray(body.conteos) || !body.conteos.length) throw new ApiError(400, 'No hay nada contado.');
  const st = Calc.stock(state, fecha);
  let creados = 0;
  body.conteos.forEach(c => {
    const p = find(state.productos, c.productoId, 'el producto');
    const real = reqNum(c.stockReal, `El stock de ${p.nombre}`, { allowZero: true });
    const dif = Calc.round2(real - (st.get(p.id) || { stock: 0 }).stock);
    if (dif === 0) return;
    state.ajustes.push({ id: uid(), fecha, productoId: p.id, cantidad: dif, motivo: 'Conteo', nota: optText(body.nota), creado: now() });
    creados++;
  });
  return { ajustes: creados };
}

function deleteAjuste(state, id) {
  remove(state.ajustes, id, 'el ajuste');
}

/* ---------- insumos ---------- */

function datosInsumo(state, body, id) {
  const nombre = reqText(body.nombre, 'el nombre', 80);
  checkUnico(state.insumos, nombre, id, 'un insumo');
  return {
    nombre, familia: optFamilia(state, body.familia, 'insumo'), unidad: optText(body.unidad, 20),
    costo: optNum(body.costo, 'El costo'), notas: optText(body.notas)
  };
}

function createInsumo(state, body) {
  const i = { id: uid(), ...datosInsumo(state, body, null), actualizado: hoy() };
  state.insumos.push(i);
  return { id: i.id };
}

// Los campos que no vienen en el body se mantienen (ej. cambiar solo el precio o la familia).
function updateInsumo(state, id, body) {
  const ins = find(state.insumos, id, 'el insumo');
  const datos = datosInsumo(state, { ...ins, ...body }, id);
  if (datos.costo !== ins.costo) datos.actualizado = hoy();
  Object.assign(ins, datos);
}

function deleteInsumo(state, id) {
  find(state.insumos, id, 'el insumo');
  const usan = Calc.productosQueUsan(state, id);
  if (usan.length) throw new ApiError(400, `No se puede borrar: lo usan ${usan.map(p => p.nombre).join(', ')}.`);
  remove(state.insumos, id, 'el insumo');
}

// Asignación de familia a varios insumos de una vez (propuesta automática revisada).
function asignarFamiliasInsumos(state, body) {
  if (!Array.isArray(body.asignaciones) || !body.asignaciones.length) throw new ApiError(400, 'No hay nada para asignar.');
  body.asignaciones.forEach(a => {
    const ins = find(state.insumos, a.insumoId, 'un insumo');
    ins.familia = optFamilia(state, a.familia, 'insumo');
  });
  return { asignados: body.asignaciones.length };
}

/* ---------- productos y recetas ---------- */

function datosProducto(state, body, id) {
  const nombre = reqText(body.nombre, 'el nombre', 80);
  checkUnico(state.productos, nombre, id, 'un producto');
  const rinde = optNum(body.rinde, 'El rinde');
  if (rinde === 0) throw new ApiError(400, 'El rinde no puede ser cero.');
  return {
    nombre,
    categoria: optFamilia(state, body.categoria, 'producto'),
    tipo: oneOf(body.tipo || 'propio', TIPOS_PRODUCTO, 'El tipo'),
    unidad: optText(body.unidad, 20),
    rinde,
    precio: optNum(body.precio, 'El precio'),
    precioMayorista: optNum(body.precioMayorista, 'El precio mayorista'),
    recargo: optNum(body.recargo, 'El recargo'),
    activo: body.activo !== false,
    stockMinimo: optNum(body.stockMinimo, 'El stock mínimo'),
    notas: optText(body.notas)
  };
}

function parseReceta(state, receta) {
  if (receta === undefined) return null; // no se tocó la receta
  if (!Array.isArray(receta)) throw new ApiError(400, 'La receta no es válida.');
  if (receta.length > 80) throw new ApiError(400, 'La receta tiene demasiados renglones.');
  const vistos = new Set();
  return receta.map(l => {
    const ins = find(state.insumos, l.insumoId, 'un insumo de la receta');
    if (vistos.has(ins.id)) throw new ApiError(400, `${ins.nombre} está dos veces en la receta.`);
    vistos.add(ins.id);
    return { insumoId: ins.id, cantidad: reqNum(l.cantidad, `La cantidad de ${ins.nombre}`) };
  });
}

function setReceta(state, productoId, lineas) {
  if (!lineas) return;
  state.recetas = state.recetas.filter(l => l.productoId !== productoId);
  lineas.forEach(l => state.recetas.push({ id: uid(), productoId, ...l }));
}

function createProducto(state, body) {
  const p = { id: uid(), ...datosProducto(state, body, null) };
  const receta = parseReceta(state, body.receta);
  state.productos.push(p);
  setReceta(state, p.id, receta);
  return { id: p.id };
}

// Los campos que no vienen se mantienen: Datos maestros no manda unidad/rinde/receta
// y el Recetario no manda precio.
function updateProducto(state, id, body) {
  const p = find(state.productos, id, 'el producto');
  const datos = datosProducto(state, { ...p, ...body }, id);
  const receta = parseReceta(state, body.receta);
  Object.assign(p, datos);
  setReceta(state, id, receta);
}

// Recetario: unidad de venta, rinde y receta de un producto.
function updateReceta(state, id, body) {
  const p = find(state.productos, id, 'el producto');
  const rinde = optNum(body.rinde, 'El rinde');
  if (rinde === 0) throw new ApiError(400, 'El rinde no puede ser cero.');
  const receta = parseReceta(state, body.receta || []);
  p.unidad = optText(body.unidad, 20);
  p.rinde = rinde;
  setReceta(state, id, receta);
}

function deleteProducto(state, id) {
  find(state.productos, id, 'el producto');
  const usado = state.producciones.some(x => x.productoId === id) || state.ventaItems.some(x => x.productoId === id)
    || state.ajustes.some(x => x.productoId === id);
  if (usado) throw new ApiError(400, 'Tiene ventas o producción cargadas: en vez de borrarlo, desactivalo.');
  remove(state.productos, id, 'el producto');
  state.recetas = state.recetas.filter(l => l.productoId !== id);
}

/* ---------- clientes ---------- */

function datosCliente(state, body, id) {
  const nombre = reqText(body.nombre, 'el nombre', 80);
  checkUnico(state.clientes, nombre, id, 'un cliente');
  return {
    nombre,
    tipo: oneOf(body.tipo || 'Particular', TIPOS_CLIENTE, 'El tipo de cliente'),
    telefono: optText(body.telefono, 40),
    notas: optText(body.notas)
  };
}

function createCliente(state, body) {
  const c = { id: uid(), ...datosCliente(state, body, null) };
  state.clientes.push(c);
  return { id: c.id };
}

function updateCliente(state, id, body) {
  Object.assign(find(state.clientes, id, 'el cliente'), datosCliente(state, body, id));
}

function deleteCliente(state, id) {
  find(state.clientes, id, 'el cliente');
  if (state.ventas.some(v => v.clienteId === id)) throw new ApiError(400, 'Tiene ventas cargadas: no se puede borrar.');
  remove(state.clientes, id, 'el cliente');
}

/* ---------- categorías de gasto ---------- */

function createCategoriaGasto(state, body) {
  const nombre = reqText(body.nombre, 'el nombre', 40);
  if (state.categoriasGasto.some(c => normName(c.nombre) === normName(nombre))) throw new ApiError(400, 'Esa categoría ya existe.');
  state.categoriasGasto.push({ nombre, grupo: oneOf(body.grupo || 'Otros', GRUPOS_GASTO, 'El grupo') });
}

// Cambia el grupo y, si viene nuevoNombre, renombra (y actualiza los gastos que la usan).
function updateCategoriaGasto(state, nombre, body) {
  const c = state.categoriasGasto.find(x => x.nombre === nombre);
  if (!c) throw new ApiError(404, 'No encontré la categoría.');
  if (body.grupo !== undefined) c.grupo = oneOf(body.grupo, GRUPOS_GASTO, 'El grupo');
  if (body.nuevoNombre !== undefined && body.nuevoNombre !== nombre) {
    const nuevo = reqText(body.nuevoNombre, 'el nombre', 40);
    if (state.categoriasGasto.some(x => x !== c && normName(x.nombre) === normName(nuevo))) throw new ApiError(400, 'Esa categoría ya existe.');
    state.gastos.forEach(g => { if (g.categoria === nombre) g.categoria = nuevo; });
    c.nombre = nuevo;
  }
}

function deleteCategoriaGasto(state, nombre) {
  if (state.gastos.some(g => g.categoria === nombre)) throw new ApiError(400, 'Hay gastos con esa categoría: no se puede borrar.');
  const i = state.categoriasGasto.findIndex(c => c.nombre === nombre);
  if (i < 0) throw new ApiError(404, 'No encontré la categoría.');
  state.categoriasGasto.splice(i, 1);
}

/* ---------- familias ---------- */

function createFamilia(state, body) {
  const tipo = oneOf(body.tipo, TIPOS_FAMILIA, 'El tipo de familia');
  const nombre = reqText(body.nombre, 'el nombre', 40);
  if (state.familias.some(f => f.tipo === tipo && normName(f.nombre) === normName(nombre))) throw new ApiError(400, 'Esa familia ya existe.');
  state.familias.push({ nombre, tipo });
}

const usosFamilia = (state, tipo, nombre) => tipo === 'producto'
  ? state.productos.filter(p => p.categoria === nombre)
  : state.insumos.filter(i => i.familia === nombre);

// Renombrar actualiza los productos o insumos que la usan.
function updateFamilia(state, tipo, nombre, body) {
  const f = state.familias.find(x => x.tipo === tipo && x.nombre === nombre);
  if (!f) throw new ApiError(404, 'No encontré la familia.');
  const nuevo = reqText(body.nuevoNombre, 'el nombre', 40);
  if (nuevo === nombre) return;
  if (state.familias.some(x => x !== f && x.tipo === tipo && normName(x.nombre) === normName(nuevo))) throw new ApiError(400, 'Esa familia ya existe.');
  usosFamilia(state, tipo, nombre).forEach(x => { if (tipo === 'producto') x.categoria = nuevo; else x.familia = nuevo; });
  f.nombre = nuevo;
}

function deleteFamilia(state, tipo, nombre) {
  const i = state.familias.findIndex(x => x.tipo === tipo && x.nombre === nombre);
  if (i < 0) throw new ApiError(404, 'No encontré la familia.');
  const n = usosFamilia(state, tipo, nombre).length;
  if (n) throw new ApiError(400, `La usan ${n} ${tipo === 'producto' ? 'productos' : 'insumos'}: no se puede borrar.`);
  state.familias.splice(i, 1);
}

/* ---------- otros ingresos (lo que entra y no es venta) ---------- */

function datosOtroIngreso(body) {
  return {
    fecha: reqDate(body.fecha),
    concepto: reqText(body.concepto, 'el concepto', 80),
    monto: reqNum(body.monto, 'El monto'),
    medioPago: optMedio(body.medioPago),
    nota: optText(body.nota)
  };
}

function createOtroIngreso(state, body) {
  const o = { id: uid(), ...datosOtroIngreso(body), creado: now() };
  state.otrosIngresos.push(o);
  return { id: o.id };
}

function updateOtroIngreso(state, id, body) {
  Object.assign(find(state.otrosIngresos, id, 'el ingreso'), datosOtroIngreso(body));
}

function deleteOtroIngreso(state, id) {
  remove(state.otrosIngresos, id, 'el ingreso');
}

module.exports = {
  MOTIVOS_AJUSTE, getState,
  createFamilia, updateFamilia, deleteFamilia, asignarFamiliasInsumos,
  createOtroIngreso, updateOtroIngreso, deleteOtroIngreso, updateReceta,
  createVenta, updateVenta, setCobro, deleteVenta,
  createGasto, updateGasto, deleteGasto,
  createProduccion, deleteProduccion, createAjuste, conteoStock, deleteAjuste,
  createInsumo, updateInsumo, deleteInsumo,
  createProducto, updateProducto, deleteProducto,
  createCliente, updateCliente, deleteCliente,
  createCategoriaGasto, updateCategoriaGasto, deleteCategoriaGasto
};
