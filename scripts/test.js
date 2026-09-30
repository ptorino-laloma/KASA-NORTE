// Pruebas sin dependencias: node scripts/test.js  (o npm test)
// Cubre el cálculo de costos, stock y resultados (public/calc.js), las
// validaciones de las rutas y la importación de la planilla vieja con datos
// de ejemplo. Si existe data/planilla-vieja.json (export local de la planilla
// real, nunca va al repo) también la importa y muestra los totales.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Calc = require('../public/calc.js');
const routes = require('../server/routes.js');
const { importar } = require('../server/importer.js');
const { DEFAULT_CATEGORIAS_GASTO } = require('../server/lib.js');

let ok = 0;
function test(nombre, fn) {
  try { fn(); ok++; console.log('ok  ', nombre); }
  catch (e) { console.error('FALLA', nombre, '\n', e); process.exitCode = 1; }
}
const vacio = () => ({
  insumos: [], productos: [], recetas: [], producciones: [], ventas: [], ventaItems: [],
  gastos: [], ajustes: [], clientes: [], categoriasGasto: DEFAULT_CATEGORIAS_GASTO.map(c => ({ ...c }))
});

// Escenario: empanada de carne, 10 docenas por tanda.
function escenario() {
  const s = vacio();
  routes.createInsumo(s, { nombre: 'Carne', unidad: 'kg', costo: 15000 });
  routes.createInsumo(s, { nombre: 'Masas', unidad: 'doc', costo: 1100 });
  routes.createInsumo(s, { nombre: 'Sal', unidad: 'kg', costo: null });
  const [carne, masas, sal] = s.insumos;
  const { id } = routes.createProducto(s, {
    nombre: 'Empanada Carne', categoria: 'Empanadas', unidad: 'docena', rinde: 10, precio: 25000, recargo: 1,
    receta: [{ insumoId: carne.id, cantidad: 3 }, { insumoId: masas.id, cantidad: 10 }, { insumoId: sal.id, cantidad: 0.05 }]
  });
  return { s, pid: id, carne };
}

test('costo por receta: tanda / rinde, insumo sin precio cuenta 0 con aviso', () => {
  const { s, pid } = escenario();
  const c = Calc.costoProducto(s, pid);
  assert.equal(c.costoTanda, 3 * 15000 + 10 * 1100);
  assert.equal(c.costoUnit, 5600);
  assert.deepEqual(c.problemas, []);
  assert.equal(c.avisos.length, 1);
  assert.equal(Calc.precioSugerido(c.costoUnit, 1), 11200);
  const m = Calc.margen(25000, c.costoUnit);
  assert.equal(Math.round(m.margen * 1000), 776);
});

test('sin rinde no hay costo (no se inventa)', () => {
  const { s, pid } = escenario();
  s.productos[0].rinde = null;
  assert.equal(Calc.costoProducto(s, pid).costoUnit, null);
});

test('stock automático: producción − ventas + ajustes; conteo ajusta la diferencia', () => {
  const { s, pid } = escenario();
  routes.createProduccion(s, { fecha: '2026-09-01', productoId: pid, cantidad: 10 });
  routes.createVenta(s, { fecha: '2026-09-02', clienteNombre: 'Ana', items: [{ productoId: pid, cantidad: 2.5, precioUnit: 25000 }] });
  routes.createAjuste(s, { fecha: '2026-09-03', productoId: pid, cantidad: -0.5, motivo: 'Merma' });
  assert.equal(Calc.stock(s).get(pid).stock, 7);
  routes.conteoStock(s, { fecha: '2026-09-04', conteos: [{ productoId: pid, stockReal: 6 }] });
  assert.equal(Calc.stock(s).get(pid).stock, 6);
  assert.equal(s.ajustes.at(-1).cantidad, -1);
});

test('la venta congela el costo: cambiar un insumo después no cambia el pasado', () => {
  const { s, pid, carne } = escenario();
  routes.createVenta(s, { fecha: '2026-09-02', items: [{ productoId: pid, cantidad: 1, precioUnit: 25000 }] });
  routes.updateInsumo(s, carne.id, { nombre: 'Carne', unidad: 'kg', costo: 20000 });
  assert.equal(s.ventaItems[0].costoUnit, 5600);
  assert.equal(Calc.costoProducto(s, pid).costoUnit, 7100);
  // Editar la venta respeta el costo congelado del producto que ya estaba
  routes.updateVenta(s, s.ventas[0].id, { fecha: '2026-09-02', items: [{ productoId: pid, cantidad: 2, precioUnit: 25000 }] });
  assert.equal(s.ventaItems[0].costoUnit, 5600);
  assert.equal(s.ventas[0].total, 50000);
});

test('resumen del mes: resultado de caja y margen teórico por separado', () => {
  const { s, pid } = escenario();
  routes.createVenta(s, { fecha: '2026-09-02', items: [{ productoId: pid, cantidad: 2, precioUnit: 25000 }] });
  routes.createVenta(s, { fecha: '2026-09-05', estadoPago: 'pendiente', items: [{ productoId: pid, cantidad: 1, precioUnit: 20000 }] });
  routes.createGasto(s, { fecha: '2026-09-03', categoria: 'Carniceria', monto: 30000 });
  routes.createGasto(s, { fecha: '2026-09-04', categoria: 'Empleada', monto: 10000 });
  routes.createGasto(s, { fecha: '2026-10-01', categoria: 'Empleada', monto: 99999 });
  const r = Calc.resumen(s, Calc.rangoMes('2026-09'));
  assert.equal(r.ventasTotal, 70000);
  assert.equal(r.cobrado, 50000);
  assert.equal(r.porCobrar, 20000);
  assert.equal(r.gastosTotal, 40000);
  assert.equal(r.porGrupo['Mercadería'], 30000);
  assert.equal(r.porGrupo['Fijos'], 10000);
  assert.equal(r.resultado, 30000);
  assert.equal(r.costoVendido, 3 * 5600);
  assert.equal(r.gananciaTeorica, 70000 - 16800);
});

test('validaciones: sin productos, cantidades negativas, categoría inexistente, duplicados', () => {
  const { s, pid, carne } = escenario();
  assert.throws(() => routes.createVenta(s, { fecha: '2026-09-02', items: [] }), /al menos un producto/);
  assert.throws(() => routes.createVenta(s, { fecha: '2026-09-02', items: [{ productoId: pid, cantidad: -1, precioUnit: 1 }] }), /negativ/);
  assert.throws(() => routes.createVenta(s, { fecha: '2026-13-02', items: [{ productoId: pid, cantidad: 1, precioUnit: 1 }] }), /fecha/);
  assert.throws(() => routes.createGasto(s, { fecha: '2026-09-02', categoria: 'Inventada', monto: 1 }), /no existe/);
  assert.throws(() => routes.createInsumo(s, { nombre: ' carne ', costo: 1 }), /Ya existe/);
  assert.throws(() => routes.deleteInsumo(s, carne.id), /lo usan/);
  routes.createProduccion(s, { fecha: '2026-09-01', productoId: pid, cantidad: 1 });
  assert.throws(() => routes.deleteProducto(s, pid), /desactivalo/);
});

test('cliente nuevo por nombre se crea una sola vez (sin importar mayúsculas)', () => {
  const { s, pid } = escenario();
  routes.createVenta(s, { fecha: '2026-09-02', clienteNombre: 'Carla', items: [{ productoId: pid, cantidad: 1, precioUnit: 1 }] });
  routes.createVenta(s, { fecha: '2026-09-03', clienteNombre: 'carla', items: [{ productoId: pid, cantidad: 1, precioUnit: 1 }] });
  assert.equal(s.clientes.length, 1);
  assert.equal(s.ventas[1].clienteId, s.clientes[0].id);
});

test('renombrar categoría de gasto actualiza los gastos', () => {
  const s = vacio();
  routes.createGasto(s, { fecha: '2026-09-03', categoria: 'Super', monto: 100 });
  routes.updateCategoriaGasto(s, 'Super', { nuevoNombre: 'Supermercado', grupo: 'Mercadería' });
  assert.equal(s.gastos[0].categoria, 'Supermercado');
});

// Planilla de ejemplo con la misma forma que las pestañas reales (datos inventados).
const serial = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000 + 25569);
function planillaEjemplo() {
  const H = ['', 'Insumo', 'Unidad', 'Costo x Unidad', '', 'Subproducto', 'Producto', 'Concepto', 'Cantidad', 'Unidad', 'Costo Unitario', 'Costo Total', '',
    'Subproducto', 'Producto', 'Porciones que Rinde', 'Costo Total', 'Costo por Porcion', 'Recargo', 'Precio de Venta Total', 'Precio de Venta por Porcion', 'Precio de venta real', 'Margen Real', 'Rentabilidad', 'Observacion'];
  const fila = (ins, rec, prod) => ['', ...(ins || ['', '', '']), '', ...(rec || ['', '', '', '', '', '', '']), '', ...(prod || ['', '', '', '', '', '', '', '', '', '', '', ''])];
  return {
    COSTOS: [[], [], [], H,
      fila(['Carne', 'KG', 15000], ['Empanada Carne', 'Empanadas', 'Carne', 3, 'kg', 15000, 45000], ['Empanada Carne', 'Empanadas', 10, 0, 0, 1, 0, 0, 25000, 0, 0, '']),
      fila(['Masas', 'DOC', 1100], ['Empanada Carne', 'Empanadas', 'Masas', 10, 'doc', 1100, 11000], ['Sorrentino JyQ', 'Pastas', 1, 0, 0, 1, 0, 0, 18000, 0, 0, '']),
      fila(['Sorrentino JyQ', 'caja', 9000], ['Sorrentino JyQ', 'Pastas', 'Sorrentino JyQ', 1, 'caja', 9000, 9000], null),
      fila(null, ['Empanada  de QyC', 'Empanadas', 'Horas de trabajo', 2, 'hs', '#N/A', '#N/A'], null)
    ],
    PRODUCCION: [[], [], [], ['', 'Fecha', 'Mes', 'Producto', 'Sub Producto', 'Cantidad', 'Costo', 'Observacion'],
      ['', serial('2026-01-10'), 1, 'Empanadas', 'Empanada Carne', 10, 0, '']],
    'INGRESOS Y EGRESOS': [[], [], [], ['', 'Fecha', 'Mes', 'Operacion', 'subp', 'Ingreso', 'Egreso', 'Cantidad', 'Cliente', 'Tipo de cliente', 'Monto', 'Estado de pago', 'Modo de pago', 'Observacion'],
      ['', serial('2026-01-11'), 1, 'Ingreso', '', 'Empanada Carne', '', 2, 'Ana', 'Particular', 50000, 'Pagado', 'Transferencia', ''],
      ['', serial('2026-01-11'), 1, 'Ingreso', '', 'Sorrentno Calabaza', '', 1, 'ana', 'Particular', 15000, 'Pagado', 'Transferencia', ''],
      ['', serial('2026-01-12'), 1, 'Ingreso', '', '', '', '', 'Beto', 'Mayorista', 30000, '', 'Efectivo', ''],
      ['', serial('2026-01-12'), 1, 'Ingreso', '', 'Empanada Carne', '', 1, 'Casa', 'Particular', '', '', '', 'autoconsumo'],
      ['', serial('2026-01-13'), 1, 'Egreso', '', '', 'Carniceria', '', '', '', 40000, 'Pagado', 'Transferencia', 'carne'],
      ['', serial('2026-01-14'), 1, 'Egreso', '', '', 'Garrafa', '', '', '', 5000, 'Pagado', 'Efectivo', ''],
      ['', '', 12, 'Egreso', '', '', 'Empleada', '', '', '', 170000, 'Pagado', '', '']],
    CLIENTES: [[], ['', ''], ['CLIENTES', 'TIPO'], ['Catering Uno', 'Frecuente'], ['Prospecto *llevar muestra']],
    'Base de datos': [[], ['', 'C INGRESOS', 'Ref', '', 'Empanadas', '', '', '', '', '', '', '', '', '', '', 'Egreso'], ['', 'Sorrentino Calabaza', 'Pastas', '', '', '', '', '', '', '', '', '', '', '', '', 'Verduleria']]
  };
}

test('importación de la planilla vieja (ejemplo)', () => {
  const r = importar(planillaEjemplo(), { hoy: '2026-09-30' });
  const d = r.data;
  const prod = n => d.productos.find(p => p.nombre === n);
  assert.ok(prod('Empanada Carne') && prod('Sorrentino JyQ') && prod('Sorrentino Calabaza'));
  assert.equal(prod('Sorrentino JyQ').tipo, 'reventa');
  assert.equal(prod('Empanada Carne').unidad, 'docena');
  assert.equal(Calc.costoProducto(d, prod('Empanada Carne').id).costoUnit, 5600);
  // "Horas de trabajo" se toma como "Hs de trabajo" (alias) y se crea si no estaba
  assert.ok(d.insumos.some(i => i.nombre === 'Horas de trabajo'));
  // "Sorrentno Calabaza" (typo) cae en "Sorrentino Calabaza"
  assert.equal(d.productos.filter(p => /calabaza/i.test(p.nombre)).length, 1);
  // Ana y ana el mismo día = una sola venta con dos renglones
  assert.equal(d.clientes.filter(c => /^ana$/i.test(c.nombre)).length, 1);
  const vAna = d.ventas.find(v => v.total === 65000);
  assert.ok(vAna);
  assert.equal(d.ventaItems.filter(i => i.ventaId === vAna.id).length, 2);
  // venta sin producto: sin renglones, mayorista
  const vBeto = d.ventas.find(v => v.total === 30000);
  assert.equal(d.ventaItems.filter(i => i.ventaId === vBeto.id).length, 0);
  assert.equal(d.clientes.find(c => c.nombre === 'Beto').tipo, 'Mayorista');
  // autoconsumo → ajuste, no venta
  assert.equal(d.ajustes.length, 1);
  assert.equal(d.ajustes[0].cantidad, -1);
  // gastos: el sin fecha se saltea; categoría nueva va a "Otros"
  assert.equal(d.gastos.length, 2);
  assert.equal(d.categoriasGasto.find(c => c.nombre === 'Garrafa').grupo, 'Otros');
  assert.ok(r.avisos.some(a => /sin fecha/.test(a.texto)));
  // stock: 10 producidas − 2 vendidas − 1 autoconsumo
  assert.equal(Calc.stock(d).get(prod('Empanada Carne').id).stock, 7);
  // CLIENTES: solo los que tienen tipo
  assert.ok(d.clientes.some(c => c.nombre === 'Catering Uno'));
  assert.ok(!d.clientes.some(c => /Prospecto/.test(c.nombre)));
});

const real = path.join(__dirname, '..', 'data', 'planilla-vieja.json');
if (fs.existsSync(real)) {
  test('importación de la planilla real local (data/planilla-vieja.json)', () => {
    const r = importar(JSON.parse(fs.readFileSync(real, 'utf8')), { hoy: '2026-09-30' });
    console.log('      ', JSON.stringify(r.resumen));
    assert.ok(r.resumen.ventas > 0 && r.resumen.productos > 0);
  });
}

console.log(`\n${ok} pruebas OK${process.exitCode ? ' — HAY FALLAS' : ''}`);
