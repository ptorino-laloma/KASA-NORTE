// Importación única desde las pestañas viejas de la planilla KASA NORTE
// (COSTOS, PRODUCCION, INGRESOS Y EGRESOS, CLIENTES, Base de datos) al formato de la app.
//
// Es una función pura: recibe las filas tal como las devuelve la API de Sheets
// (valores calculados, fechas como número de serie) y devuelve las tablas nuevas
// más una lista de avisos de todo lo que no cerraba en la planilla. No escribe nada.
// Las columnas se ubican por el texto del encabezado, no por posición fija.
//
// Ver estado.md § Migración para las decisiones tomadas.

const Calc = require('../public/calc.js');
const { uid, normName } = require('./lib.js');

const TABS = ['COSTOS', 'PRODUCCION', 'INGRESOS Y EGRESOS', 'CLIENTES', 'Base de datos'];

// Errores de tipeo vistos en la planilla (clave normalizada → clave correcta).
const ALIAS = {
  'sorrentno calabaza': 'sorrentino calabaza',
  'horas de trabajo': 'hs de trabajo'
};
const key = s => { const k = normName(s); return ALIAS[k] || k; };
const clean = s => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim();

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.')))) return Number(v.replace(',', '.'));
  return null; // vacío, texto o error de fórmula (#DIV/0!, #N/A)
}

// Número de serie de Sheets/Excel (días desde 30/12/1899) → 'YYYY-MM-DD'.
function fecha(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  if (typeof v === 'string') {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

// Busca la fila de encabezado que contenga todos los textos pedidos.
function header(rows, must) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = (rows[r] || []).map(c => normName(c));
    if (must.every(m => cells.includes(normName(m)))) {
      // col(nombre, desde): primera columna con ese encabezado a partir de 'desde'
      const col = (name, from = 0) => {
        const i = cells.indexOf(normName(name), from);
        if (i < 0) throw new Error(`No encuentro la columna "${name}"`);
        return i;
      };
      return { row: r, col };
    }
  }
  return null;
}

function unidadPorDefecto(nombre, categoria) {
  const c = normName(categoria), n = normName(nombre);
  if (c === 'empanadas') return 'docena';
  if (c === 'pastas') return 'caja';
  if (c === 'pizzas' || n.startsWith('hamburguesa')) return 'unidad';
  return 'porción';
}

function importar(raw, { hoy } = {}) {
  const avisos = [];
  const aviso = (seccion, texto) => avisos.push({ seccion, texto });
  const falta = TABS.filter(t => !raw[t]);
  if (falta.includes('COSTOS') || falta.includes('INGRESOS Y EGRESOS')) {
    throw new Error('No encuentro las pestañas COSTOS e INGRESOS Y EGRESOS en la planilla.');
  }
  falta.forEach(t => aviso('General', `No está la pestaña "${t}": se saltea.`));

  const insumos = [], productos = [], recetas = [], producciones = [], ventas = [], ventaItems = [];
  const gastos = [], ajustes = [], clientes = [], categoriasGasto = [];
  const insByKey = new Map(), prodByKey = new Map(), cliByKey = new Map();

  /* ---------- insumos (COSTOS, tabla "COSTO DE INSUMOS") ---------- */
  const costos = raw['COSTOS'];
  const hc = header(costos, ['Insumo', 'Concepto', 'Porciones que Rinde']);
  if (!hc) throw new Error('No encuentro el encabezado de la pestaña COSTOS.');
  const cIns = hc.col('Insumo'), cInsUni = cIns + 1, cInsCosto = hc.col('Costo x Unidad');
  for (let r = hc.row + 1; r < costos.length; r++) {
    const row = costos[r] || [];
    const nombre = clean(row[cIns]);
    if (!nombre) continue;
    if (insByKey.has(key(nombre))) { aviso('Insumos', `"${nombre}" está repetido en la lista de insumos: se usa el primero.`); continue; }
    const costo = num(row[cInsCosto]);
    if (costo === null) aviso('Insumos', `"${nombre}" no tiene precio.`);
    const ins = { id: uid(), nombre, familia: null, unidad: clean(row[cInsUni]) || null, costo, actualizado: null, notas: null };
    insumos.push(ins);
    insByKey.set(key(nombre), ins);
  }

  /* ---------- productos (COSTOS, tabla "COSTO Y PRECIO DE VENTA") ---------- */
  const cPor = hc.col('Porciones que Rinde');
  const cPSub = cPor - 2, cPCat = cPor - 1;
  const cRec = hc.col('Recargo', cPor), cReal = hc.col('Precio de venta real', cPor), cObs = hc.col('Observacion', cPor);
  function addProducto(nombre, categoria, extra = {}) {
    const p = {
      id: uid(), nombre, categoria: categoria || null, tipo: 'propio', unidad: unidadPorDefecto(nombre, categoria),
      rinde: null, precio: null, precioMayorista: null, recargo: 1, activo: true, stockMinimo: null, notas: null, ...extra
    };
    productos.push(p);
    prodByKey.set(key(nombre), p);
    return p;
  }
  for (let r = hc.row + 1; r < costos.length; r++) {
    const row = costos[r] || [];
    const nombre = clean(row[cPSub]);
    if (!nombre) continue;
    if (prodByKey.has(key(nombre))) { aviso('Productos', `"${nombre}" está repetido en la tabla de precios: se usa el primero.`); continue; }
    const rinde = num(row[cPor]);
    const precio = num(row[cReal]);
    const rec = num(row[cRec]);
    addProducto(nombre, clean(row[cPCat]) || null, {
      rinde: rinde > 0 ? rinde : null, precio: precio > 0 ? precio : null,
      recargo: rec === null ? 1 : rec, notas: clean(row[cObs]) || null
    });
    if (!(rinde > 0)) aviso('Productos', `"${nombre}" no tiene cargado cuántas porciones rinde: su costo queda sin calcular.`);
    if (!(precio > 0)) aviso('Productos', `"${nombre}" no tiene precio de venta.`);
  }

  /* ---------- recetas (COSTOS, tabla "COSTO DE PRODUCTOS") ---------- */
  const cCon = hc.col('Concepto');
  const cRSub = cCon - 2, cRCat = cCon - 1, cRCant = cCon + 1, cRCu = cCon + 3;
  const lineaPorProdIns = new Map();
  for (let r = hc.row + 1; r < costos.length; r++) {
    const row = costos[r] || [];
    const pNombre = clean(row[cRSub]), iNombre = clean(row[cCon]);
    if (!pNombre || !iNombre) continue;
    let p = prodByKey.get(key(pNombre));
    if (!p) {
      p = addProducto(pNombre, clean(row[cRCat]) || null);
      aviso('Recetas', `"${pNombre}" tiene receta pero no está en la tabla de precios: se crea sin rinde ni precio.`);
    }
    const cant = num(row[cRCant]);
    if (!(cant > 0)) { aviso('Recetas', `${pNombre}: "${iNombre}" no tiene cantidad, se saltea.`); continue; }
    let ins = insByKey.get(key(iNombre));
    const cuHoja = num(row[cRCu]);
    if (!ins) {
      // Sin precio en la receta pero con costo total 0 (ej. "Agua"): la planilla lo costeaba en $0.
      const totHoja = num(row[cCon + 4]);
      const costo = cuHoja !== null ? cuHoja : totHoja === 0 ? 0 : null;
      ins = { id: uid(), nombre: iNombre, familia: null, unidad: clean(row[cCon + 2]) || null, costo, actualizado: null, notas: 'Creado en la importación (estaba en una receta pero no en la lista de insumos)' };
      insumos.push(ins);
      insByKey.set(key(iNombre), ins);
      aviso('Recetas', `"${iNombre}" (receta de ${pNombre}) no estaba en la lista de insumos: se crea${costo === null ? ' sin precio' : ' con $' + costo}.`);
    } else if (cuHoja !== null && ins.costo !== null && Math.abs(cuHoja - ins.costo) > 0.5) {
      aviso('Recetas', `En la receta de ${pNombre}, "${ins.nombre}" figuraba a $${cuHoja} y en la lista de insumos a $${ins.costo}. La app usa siempre el de la lista.`);
    }
    const k = p.id + '|' + ins.id;
    if (lineaPorProdIns.has(k)) {
      lineaPorProdIns.get(k).cantidad += cant;
      aviso('Recetas', `${pNombre}: "${ins.nombre}" aparecía dos veces, se suman las cantidades.`);
      continue;
    }
    const l = { id: uid(), productoId: p.id, insumoId: ins.id, cantidad: cant };
    recetas.push(l);
    lineaPorProdIns.set(k, l);
  }
  // Reventa (tercerizado): la receta es un único insumo con el mismo nombre del producto
  // (ej. "Sorrentino JyQ" se compra por caja y se vende por caja).
  productos.forEach(p => {
    const ls = recetas.filter(l => l.productoId === p.id);
    if (ls.length === 1) {
      const ins = insumos.find(i => i.id === ls[0].insumoId);
      if (ins && key(ins.nombre) === key(p.nombre)) p.tipo = 'reventa';
    }
  });

  /* ---------- productos de la lista "Base de datos" que falten ---------- */
  const bd = raw['Base de datos'];
  const hb = bd && header(bd, ['C INGRESOS', 'Ref']);
  const catEgresoBD = [];
  if (hb) {
    const cN = hb.col('C INGRESOS'), cC = hb.col('Ref');
    let cEg = -1;
    try { cEg = hb.col('Egreso'); } catch { /* sin columna de egresos */ }
    for (let r = hb.row + 1; r < bd.length; r++) {
      const row = bd[r] || [];
      const n = clean(row[cN]);
      if (n && !prodByKey.has(key(n))) addProducto(n, clean(row[cC]) || null);
      if (cEg >= 0 && clean(row[cEg])) catEgresoBD.push(clean(row[cEg]));
    }
  }
  const productoPara = (nombre, seccion) => {
    const n = clean(nombre);
    if (!n) return null;
    let p = prodByKey.get(key(n));
    if (!p) {
      p = addProducto(n, null);
      aviso(seccion, `"${n}" no estaba en la lista de productos: se crea sin receta ni precio.`);
    }
    return p;
  };

  /* ---------- clientes ---------- */
  function clientePara(nombre, tipo) {
    const n = clean(nombre);
    if (!n) return null;
    const k = key(n);
    let c = cliByKey.get(k);
    if (!c) {
      c = { id: uid(), nombre: n, tipo: 'Particular', telefono: null, notas: null };
      clientes.push(c);
      cliByKey.set(k, c);
    } else if (c.nombre[0] !== c.nombre[0].toUpperCase() && n[0] === n[0].toUpperCase()) {
      c.nombre = n; // "carla" y "Carla" son la misma: queda la que empieza con mayúscula
    }
    if (normName(tipo) === 'mayorista') c.tipo = 'Mayorista';
    return c;
  }
  const cl = raw['CLIENTES'];
  const hcl = cl && header(cl, ['CLIENTES', 'TIPO']);
  if (hcl) {
    const cN = hcl.col('CLIENTES'), cT = hcl.col('TIPO');
    for (let r = hcl.row + 1; r < cl.length; r++) {
      const row = cl[r] || [];
      const t = clean(row[cT]);
      // Solo los que tienen tipo Frecuente/Esporádico; el resto son posibles clientes con notas.
      if (clean(row[cN]) && ['frecuente', 'esporadico'].includes(normName(t))) {
        const c = clientePara(row[cN]);
        c.notas = t;
      }
    }
  }

  /* ---------- categorías de gasto ---------- */
  const { DEFAULT_CATEGORIAS_GASTO } = require('./lib.js');
  DEFAULT_CATEGORIAS_GASTO.forEach(c => categoriasGasto.push({ ...c }));
  const catPara = nombre => {
    let c = categoriasGasto.find(x => key(x.nombre) === key(nombre));
    if (!c) {
      c = { nombre: clean(nombre), grupo: 'Otros' };
      categoriasGasto.push(c);
      aviso('Gastos', `Categoría nueva "${c.nombre}": quedó en el grupo "Otros" (se cambia en Configuración).`);
    }
    return c.nombre;
  };
  catEgresoBD.forEach(catPara);

  /* ---------- producción (PRODUCCION) ---------- */
  const pr = raw['PRODUCCION'];
  const hp = pr && header(pr, ['Fecha', 'Sub Producto', 'Cantidad']);
  const futuras = [];
  if (hp) {
    const cF = hp.col('Fecha'), cS = hp.col('Sub Producto'), cQ = hp.col('Cantidad'), cO = hp.col('Observacion');
    for (let r = hp.row + 1; r < pr.length; r++) {
      const row = pr[r] || [];
      const f = fecha(row[cF]), q = num(row[cQ]);
      if (!clean(row[cS])) continue;
      if (!f || !(q > 0)) { aviso('Producción', `Fila ${r + 1}: falta la fecha o la cantidad, se saltea.`); continue; }
      const p = productoPara(row[cS], 'Producción');
      if (hoy && f > hoy) futuras.push(`${f} ${p.nombre}`);
      producciones.push({ id: uid(), fecha: f, productoId: p.id, cantidad: q, costoUnit: null, nota: clean(row[cO]) || null, creado: '' });
    }
  }
  if (futuras.length) aviso('Producción', `${futuras.length} tandas tienen fecha futura (¿2025 tipeado como 2026?): ${futuras.join('; ')}. Se importan tal cual; revisalas.`);

  /* ---------- ventas y gastos (INGRESOS Y EGRESOS) ---------- */
  const ie = raw['INGRESOS Y EGRESOS'];
  const hi = header(ie, ['Fecha', 'Operacion', 'Ingreso', 'Egreso', 'Monto']);
  if (!hi) throw new Error('No encuentro el encabezado de la pestaña INGRESOS Y EGRESOS.');
  const C = {
    f: hi.col('Fecha'), op: hi.col('Operacion'), ing: hi.col('Ingreso'), eg: hi.col('Egreso'), q: hi.col('Cantidad'),
    cli: hi.col('Cliente'), tc: hi.col('Tipo de cliente'), m: hi.col('Monto'), est: hi.col('Estado de pago'),
    med: hi.col('Modo de pago'), obs: hi.col('Observacion')
  };
  let cSubp = -1;
  try { cSubp = hi.col('subp'); } catch { /* columna opcional */ }
  const medio = v => { const k = normName(v); return k === 'transferencia' ? 'Transferencia' : k === 'efectivo' ? 'Efectivo' : k ? 'Otro' : null; };
  let sinEstado = 0, sinMonto = 0, sinDetalle = 0, autoconsumos = 0;
  let actual = null; // venta que se está armando (renglones seguidos del mismo cliente y día)

  for (let r = hi.row + 1; r < ie.length; r++) {
    const row = ie[r] || [];
    const op = normName(row[C.op]);
    if (!op) continue;
    const f = fecha(row[C.f]);
    const monto = num(row[C.m]);
    const obs = clean(row[C.obs]) || null;

    if (op === 'egreso') {
      actual = null;
      if (!f) { aviso('Gastos', `Fila ${r + 1}: egreso sin fecha (${clean(row[C.eg])} $${monto}), se saltea.`); continue; }
      if (!(monto > 0)) { aviso('Gastos', `Fila ${r + 1}: egreso sin monto, se saltea.`); continue; }
      const cat = clean(row[C.eg]) || 'Varios';
      gastos.push({
        id: uid(), fecha: f, categoria: catPara(cat), monto, medioPago: medio(row[C.med]),
        estadoPago: 'pagado', proveedor: null, nota: obs, creado: ''
      });
      continue;
    }
    if (op !== 'ingreso') { aviso('Ventas', `Fila ${r + 1}: operación "${clean(row[C.op])}" desconocida, se saltea.`); continue; }
    if (!f) { aviso('Ventas', `Fila ${r + 1}: ingreso sin fecha, se saltea.`); actual = null; continue; }

    const nombreProd = clean(row[C.ing]) || (cSubp >= 0 ? clean(row[cSubp]) : '');
    const q = num(row[C.q]);
    const cli = clientePara(row[C.cli], row[C.tc]);
    const est = normName(row[C.est]);
    if (!est) sinEstado++;
    const estadoPago = est === 'pendiente' || est === 'debe' ? 'pendiente' : 'pagado';

    // Autoconsumo sin cobro: no es una venta, es una salida de stock.
    if (nombreProd && /autoconsumo/i.test(obs || '') && !(monto > 0)) {
      const p = productoPara(nombreProd, 'Ventas');
      ajustes.push({ id: uid(), fecha: f, productoId: p.id, cantidad: -(q > 0 ? q : 1), motivo: 'Autoconsumo', nota: 'Importado', creado: '' });
      autoconsumos++;
      actual = null;
      continue;
    }

    if (!nombreProd) {
      // Venta sin detalle de producto (desde mayo 2026 casi todas): solo el total.
      actual = null;
      if (!(monto > 0)) { aviso('Ventas', `Fila ${r + 1}: ingreso sin producto ni monto, se saltea.`); continue; }
      sinDetalle++;
      const nota = [obs, q ? `Cantidad en la planilla: ${q}` : null].filter(Boolean).join(' · ') || null;
      ventas.push({ id: uid(), fecha: f, clienteId: cli ? cli.id : null, total: monto, estadoPago, medioPago: medio(row[C.med]), nota, creado: '' });
      continue;
    }

    const p = productoPara(nombreProd, 'Ventas');
    const cantidad = q > 0 ? q : 1;
    if (!(q > 0)) aviso('Ventas', `Fila ${r + 1}: ${p.nombre} sin cantidad, se toma 1.`);
    if (monto === null) sinMonto++;
    const total = monto || 0;
    const mismo = actual && cli && actual.clienteId === cli.id && actual.fecha === f
      && actual.estadoPago === estadoPago && actual.medioPago === medio(row[C.med]);
    if (!mismo) {
      actual = { id: uid(), fecha: f, clienteId: cli ? cli.id : null, total: 0, estadoPago, medioPago: medio(row[C.med]), nota: obs, creado: '' };
      ventas.push(actual);
    } else if (obs && actual.nota !== obs) {
      actual.nota = [actual.nota, obs].filter(Boolean).join(' · ');
    }
    actual.total += total;
    ventaItems.push({ id: uid(), ventaId: actual.id, productoId: p.id, cantidad, precioUnit: Calc.round2(total / cantidad), costoUnit: null });
  }
  if (sinDetalle) aviso('Ventas', `${sinDetalle} ventas no tenían producto (solo cliente y monto): cuentan para la caja pero no descuentan stock ni entran en la rentabilidad por producto.`);
  if (sinMonto) aviso('Ventas', `${sinMonto} renglones de venta no tenían monto: se importan a $0.`);
  if (sinEstado) aviso('Ventas', `${sinEstado} ingresos no tenían estado de pago: se toman como cobrados.`);
  if (autoconsumos) aviso('Stock', `${autoconsumos} renglones de autoconsumo sin cobro se pasan como ajuste de stock (no como venta).`);

  /* ---------- costos congelados con los precios de hoy ---------- */
  /* ---------- familias: las categorías de producto de la planilla + las de insumo por defecto ---------- */
  const { DEFAULT_FAMILIAS_INSUMO } = require('./lib.js');
  const familias = [];
  productos.forEach(p => { if (p.categoria && !familias.some(f => f.tipo === 'producto' && f.nombre === p.categoria)) familias.push({ nombre: p.categoria, tipo: 'producto' }); });
  DEFAULT_FAMILIAS_INSUMO.forEach(n => familias.push({ nombre: n, tipo: 'insumo' }));
  // La planilla no tenía familia de insumo: se propone una por palabra clave (revisable).
  const famIns = familias.filter(f => f.tipo === 'insumo').map(f => f.nombre);
  let propuestas = 0;
  insumos.forEach(i => { i.familia = Calc.familiaSugerida(i.nombre, famIns); if (i.familia) propuestas++; });
  const sinFam = insumos.filter(i => !i.familia).map(i => i.nombre);
  aviso('Insumos', `La planilla no tenía familia de insumos: se propuso una automáticamente para ${propuestas} (por el nombre). Revisalas en Datos maestros → Insumos.` +
    (sinFam.length ? ` Quedaron sin familia: ${sinFam.join(', ')}.` : ''));

  const st = { insumos, productos, recetas, producciones, ventas, ventaItems, gastos, ajustes, clientes, categoriasGasto, familias, otrosIngresos: [] };
  const costos_ = Calc.costosTodos(st);
  const cu = id => { const c = costos_.get(id); return c && c.costoUnit !== null ? Calc.round2(c.costoUnit) : null; };
  producciones.forEach(p => { p.costoUnit = cu(p.productoId); });
  ventaItems.forEach(i => { i.costoUnit = cu(i.productoId); });
  ventas.forEach(v => { v.total = Calc.round2(v.total); });
  aviso('General', 'El costo de las ventas y la producción importadas se calcula con los precios de insumos de HOY (la planilla no guardaba el costo de cada momento). La rentabilidad histórica es aproximada.');

  const sinCosto = productos.filter(p => cu(p.id) === null).map(p => p.nombre);
  if (sinCosto.length) aviso('Costos', `Quedan sin costo calculable (${sinCosto.length}): ${sinCosto.join(', ')}. Completá receta, rinde o precios en Costos.`);

  const resumen = {
    insumos: insumos.length, productos: productos.length, recetas: recetas.length, producciones: producciones.length,
    ventas: ventas.length, ventaItems: ventaItems.length, gastos: gastos.length, ajustes: ajustes.length,
    clientes: clientes.length, categoriasGasto: categoriasGasto.length, familias: familias.length,
    totalVentas: Calc.round2(Calc.sum(ventas, v => v.total)), totalGastos: Calc.round2(Calc.sum(gastos, g => g.monto))
  };
  return { data: st, resumen, avisos };
}

module.exports = { importar, TABS, fecha, num };
