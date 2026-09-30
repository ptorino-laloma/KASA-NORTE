// Cálculos del negocio: costo por receta, stock, estado de resultados y rentabilidad.
// Este archivo es el ÚNICO lugar donde viven estas reglas. Lo usa el navegador
// (<script src="/calc.js"> → window.Calc) y también el servidor
// (require('../public/calc.js')) para congelar el costo al registrar ventas y producción.
// Sin dependencias y sin tocar el DOM.
(function (root) {
  'use strict';

  const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
  const round2 = n => Math.round(n * 100) / 100;

  function byId(list) {
    const m = new Map();
    (list || []).forEach(x => m.set(x.id, x));
    return m;
  }

  function groupBy(list, key) {
    const m = new Map();
    (list || []).forEach(x => {
      const k = x[key];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    });
    return m;
  }

  // Rango de fechas 'YYYY-MM-DD' (inclusive). Para un mes: rangoMes('2026-05').
  // El "hasta" '-31' funciona para cualquier mes porque se compara como texto.
  function rangoMes(ym) { return { desde: ym + '-01', hasta: ym + '-31' }; }
  function rangoAnio(y) { return { desde: y + '-01-01', hasta: y + '-12-31' }; }
  function enRango(fecha, r) { return !r || (fecha >= r.desde && fecha <= r.hasta); }

  /* ---------- costos ---------- */

  // Costo de un producto con su receta y los precios ACTUALES de los insumos.
  //   costoTanda = Σ cantidad × costo del insumo
  //   costoUnit  = costoTanda / rinde   (rinde = unidades de venta que salen de una tanda)
  // Si falta la receta o el rinde, costoUnit queda null (no se inventa un costo) y
  // 'problemas' dice qué falta. Un insumo sin precio cuenta como $0 pero queda
  // anotado en 'avisos' (costo incompleto), para que una pizca de algo sin precio
  // no deje todo el producto sin costo.
  function costoProducto(state, productoId, cache) {
    const idx = cache || indices(state);
    const p = idx.productos.get(productoId);
    const lineas = (idx.recetasPorProducto.get(productoId) || []).map(l => {
      const ins = idx.insumos.get(l.insumoId);
      const cu = ins && ins.costo !== null && ins.costo !== undefined ? Number(ins.costo) : null;
      return {
        id: l.id, insumoId: l.insumoId, nombre: ins ? ins.nombre : '(insumo borrado)',
        unidad: ins ? ins.unidad : null, cantidad: l.cantidad, costoInsumo: cu,
        total: cu === null ? null : l.cantidad * cu
      };
    });
    const problemas = [];
    if (!p) problemas.push('producto inexistente');
    if (!lineas.length) problemas.push('sin receta');
    if (p && !(p.rinde > 0)) problemas.push('falta el rinde');
    const avisos = [];
    const sinPrecio = lineas.filter(l => l.total === null).map(l => l.nombre);
    if (sinPrecio.length) avisos.push('sin precio: ' + sinPrecio.join(', '));
    const costoTanda = sum(lineas.filter(l => l.total !== null), l => l.total);
    const costoUnit = problemas.length ? null : costoTanda / p.rinde;
    return { lineas, costoTanda, costoUnit, problemas, avisos };
  }

  function indices(state) {
    return {
      productos: byId(state.productos),
      insumos: byId(state.insumos),
      clientes: byId(state.clientes),
      recetasPorProducto: groupBy(state.recetas, 'productoId'),
      itemsPorVenta: groupBy(state.ventaItems, 'ventaId')
    };
  }

  // Mapa productoId → resultado de costoProducto, para todos los productos.
  function costosTodos(state) {
    const idx = indices(state);
    const m = new Map();
    state.productos.forEach(p => m.set(p.id, costoProducto(state, p.id, idx)));
    return m;
  }

  // Precio que convendría cobrar: costo × (1 + recargo). recargo 1 = 100% (como en la planilla vieja).
  function precioSugerido(costoUnit, recargo) {
    if (costoUnit === null || costoUnit === undefined) return null;
    const r = recargo === null || recargo === undefined ? 1 : Number(recargo);
    return costoUnit * (1 + r);
  }

  // margen = ganancia / precio  (qué parte del precio es ganancia)
  // markup = ganancia / costo   (cuánto se le suma al costo; la "rentabilidad" de la planilla vieja)
  function margen(precio, costoUnit) {
    if (!(precio > 0) || costoUnit === null || costoUnit === undefined) return null;
    const ganancia = precio - costoUnit;
    return { ganancia, margen: ganancia / precio, markup: costoUnit > 0 ? ganancia / costoUnit : null };
  }

  // Productos que usan un insumo (para mostrar a quién afecta un cambio de precio).
  function productosQueUsan(state, insumoId) {
    const ids = new Set(state.recetas.filter(l => l.insumoId === insumoId).map(l => l.productoId));
    return state.productos.filter(p => ids.has(p.id));
  }

  /* ---------- stock ---------- */

  // Stock de productos terminados = producido − vendido + ajustes.
  // Es automático: cada venta con detalle descuenta, cada producción suma.
  // 'hasta' (opcional, 'YYYY-MM-DD') calcula el stock a esa fecha.
  function stock(state, hasta) {
    const m = new Map();
    const get = id => {
      if (!m.has(id)) m.set(id, { producido: 0, vendido: 0, ajustado: 0, stock: 0 });
      return m.get(id);
    };
    state.productos.forEach(p => get(p.id));
    const ok = f => !hasta || f <= hasta;
    state.producciones.forEach(p => { if (ok(p.fecha)) get(p.productoId).producido += p.cantidad; });
    const fechaVenta = new Map(state.ventas.map(v => [v.id, v.fecha]));
    state.ventaItems.forEach(i => {
      const f = fechaVenta.get(i.ventaId);
      if (f !== undefined && ok(f)) get(i.productoId).vendido += i.cantidad;
    });
    state.ajustes.forEach(a => { if (ok(a.fecha)) get(a.productoId).ajustado += a.cantidad; });
    m.forEach(s => { s.stock = round2(s.producido - s.vendido + s.ajustado); });
    return m;
  }

  /* ---------- resultados ---------- */

  function grupoDe(state, categoria) {
    const c = state.categoriasGasto.find(x => x.nombre === categoria);
    return c ? c.grupo : 'Otros';
  }

  // Resumen de un período (r = {desde, hasta}; sin r = todo).
  //
  // Dos miradas que NO se mezclan, para no contar dos veces lo mismo:
  //  - Caja real: ventas − egresos cargados (lo que entró y salió de verdad).
  //  - Rentabilidad teórica: ventas con detalle − costo de receta de lo vendido
  //    (el costo que quedó congelado en cada venta). Las recetas ya incluyen horas
  //    de trabajo y luz/gas, por eso esto no se resta además de los egresos.
  function resumen(state, r) {
    const idx = indices(state);
    const ventas = state.ventas.filter(v => enRango(v.fecha, r));
    const gastos = state.gastos.filter(g => enRango(g.fecha, r));

    const ventasTotal = sum(ventas, v => v.total);
    const cobrado = sum(ventas.filter(v => v.estadoPago === 'pagado'), v => v.total);
    const porCobrar = ventasTotal - cobrado;

    let ingresoConCosto = 0, costoVendido = 0, ingresoSinCosto = 0, ventasSinDetalle = 0;
    ventas.forEach(v => {
      const items = idx.itemsPorVenta.get(v.id) || [];
      if (!items.length) { ventasSinDetalle += v.total; return; }
      items.forEach(i => {
        const ing = i.cantidad * i.precioUnit;
        if (i.costoUnit === null || i.costoUnit === undefined) ingresoSinCosto += ing;
        else { ingresoConCosto += ing; costoVendido += i.cantidad * i.costoUnit; }
      });
    });

    const porCategoria = {};
    const porGrupo = { 'Mercadería': 0, 'Fijos': 0, 'Otros': 0 };
    gastos.forEach(g => {
      porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto;
      const gr = grupoDe(state, g.categoria);
      porGrupo[gr] = (porGrupo[gr] || 0) + g.monto;
    });
    const gastosTotal = sum(gastos, g => g.monto);
    const gastosPendientes = sum(gastos.filter(g => g.estadoPago === 'pendiente'), g => g.monto);

    return {
      cantVentas: ventas.length,
      ventasTotal, cobrado, porCobrar,
      gastosTotal, gastosPendientes, porCategoria, porGrupo,
      resultado: ventasTotal - gastosTotal,
      // teórico
      ingresoConCosto, costoVendido, ingresoSinCosto, ventasSinDetalle,
      gananciaTeorica: ingresoConCosto - costoVendido,
      margenTeorico: ingresoConCosto > 0 ? (ingresoConCosto - costoVendido) / ingresoConCosto : null
    };
  }

  // Ventas por producto en el período: unidades, ingresos, costo congelado y ganancia.
  function porProducto(state, r) {
    const fechaVenta = new Map(state.ventas.map(v => [v.id, v.fecha]));
    const m = new Map();
    state.ventaItems.forEach(i => {
      const f = fechaVenta.get(i.ventaId);
      if (f === undefined || !enRango(f, r)) return;
      if (!m.has(i.productoId)) m.set(i.productoId, { productoId: i.productoId, cantidad: 0, ingresos: 0, costo: 0, ingresosConCosto: 0 });
      const x = m.get(i.productoId);
      const ing = i.cantidad * i.precioUnit;
      x.cantidad += i.cantidad;
      x.ingresos += ing;
      if (i.costoUnit !== null && i.costoUnit !== undefined) { x.costo += i.cantidad * i.costoUnit; x.ingresosConCosto += ing; }
    });
    return [...m.values()].map(x => ({
      ...x,
      ganancia: x.ingresosConCosto - x.costo,
      margen: x.ingresosConCosto > 0 ? (x.ingresosConCosto - x.costo) / x.ingresosConCosto : null
    })).sort((a, b) => b.ingresos - a.ingresos);
  }

  // Compras por cliente en el período.
  function porCliente(state, r) {
    const m = new Map();
    state.ventas.forEach(v => {
      if (!enRango(v.fecha, r)) return;
      const k = v.clienteId || '';
      if (!m.has(k)) m.set(k, { clienteId: v.clienteId || null, cantVentas: 0, total: 0, pendiente: 0, ultima: '' });
      const x = m.get(k);
      x.cantVentas++;
      x.total += v.total;
      if (v.estadoPago === 'pendiente') x.pendiente += v.total;
      if (v.fecha > x.ultima) x.ultima = v.fecha;
    });
    return [...m.values()].sort((a, b) => b.total - a.total);
  }

  // Resumen mes a mes de un año (para la tabla del estado de resultados).
  function porMes(state, anio) {
    const out = [];
    for (let mes = 1; mes <= 12; mes++) {
      const ym = `${anio}-${String(mes).padStart(2, '0')}`;
      out.push({ mes: ym, ...resumen(state, rangoMes(ym)) });
    }
    return out;
  }

  const api = {
    sum, round2, byId, groupBy, indices, rangoMes, rangoAnio, enRango,
    costoProducto, costosTodos, precioSugerido, margen, productosQueUsan,
    stock, grupoDe, resumen, porProducto, porCliente, porMes
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
