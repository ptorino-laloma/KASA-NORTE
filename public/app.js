// Frontend de Kasa Norte. Sin frameworks ni build: HTML en index.html, cálculos
// del negocio en calc.js (window.Calc, compartido con el servidor) y acá la UI.
//
// Patrón: GET /api/state trae todo; cada mutación devuelve el state completo
// actualizado y se vuelve a dibujar la pestaña activa. El servidor valida todo.
'use strict';

/* ================= utilidades ================= */

const $ = id => document.getElementById(id);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MEDIOS = ['Transferencia', 'Efectivo', 'Otro'];

let S = null;          // state del servidor
let C = null;          // cálculos derivados (se rehacen con cada state)
let tabActual = 'inicio';

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmt(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  return (n < 0 ? '−$' : '$') + abs.toLocaleString('es-AR', { maximumFractionDigits: abs < 100 ? 2 : 0 });
}
// $6,9M · $435k · $900 (para etiquetas del gráfico)
function fmtC(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '−$' : '$';
  if (a >= 1e6) return s + (a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + 'M';
  if (a >= 1e3) return s + Math.round(a / 1e3) + 'k';
  return s + Math.round(a);
}
function fmtQ(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
}
function pct(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return Math.round(x * 100) + '%';
}
function fDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : (iso || '');
}
function mesLabel(ym) {
  const [y, m] = ym.split('-');
  const s = MESES[Number(m) - 1] + ' ' + y;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const mesCorto = ym => MESES_C[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(2, 4);
function hoy() { return (S && S.config && S.config.hoy) || new Date().toISOString().slice(0, 10); }
function mesActual() { return hoy().slice(0, 7); }
const moverMes = (ym, d) => Calc.sumarMeses(ym, d);
function numVal(id) {
  const v = $(id).value.trim().replace(',', '.');
  return v === '' ? null : Number(v);
}
function toast(msg, error) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!error);
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove('show'), error ? 4500 : 2600);
}
function fillSelect(sel, options, placeholder) {
  const prev = sel.value;
  sel.innerHTML = (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '') +
    options.map(o => typeof o === 'string'
      ? `<option value="${esc(o)}">${esc(o)}</option>`
      : o.group !== undefined
        ? `<optgroup label="${esc(o.group)}">${o.options.map(x => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('')}</optgroup>`
        : `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}
function setSeg(id, v) { document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('on', b.dataset.v === v)); }
// Descarga CSV que Excel abre bien en español (separador ; y coma decimal).
function descargarCSV(nombre, filas) {
  const cel = v => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(Math.round(v * 100) / 100).replace('.', ',');
    const s = String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = '﻿' + filas.map(f => f.map(cel).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ================= API ================= */

async function api(method, url, body) {
  document.body.classList.add('busy');
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch { /* respuesta vacía */ }
    if (res.status === 401 && url !== '/api/login') { showLogin('Tu sesión venció. Ingresá de nuevo.'); throw new Error('sesión'); }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    if (data.state) setState(data.state);
    return data;
  } catch (e) {
    if (e.message !== 'sesión') toast(e.message === 'Failed to fetch' ? 'Sin conexión con el servidor.' : e.message, true);
    throw e;
  } finally {
    document.body.classList.remove('busy');
  }
}
// Para los botones: evita doble click mientras se guarda.
async function guardando(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { await fn(); } catch { /* ya se mostró el error */ } finally { btn.disabled = false; }
}

function setState(state) {
  S = state;
  C = { idx: Calc.indices(S), costos: Calc.costosTodos(S), stock: Calc.stock(S) };
  $('hoy-label').textContent = fDate(hoy());
  refreshListas();
  render();
}

/* ================= sesión ================= */

async function showLogin(msg) {
  document.body.classList.remove('logged-in');
  $('login-error').textContent = msg || '';
  try {
    const info = await (await fetch('/api/login')).json();
    if (!$('login-user').value) $('login-user').value = info.usuario || '';
  } catch { $('login-error').textContent = 'No pude conectarme con el servidor.'; }
}
async function login() {
  $('login-error').textContent = '';
  try {
    await api('POST', '/api/login', { usuario: $('login-user').value, clave: $('login-pass').value });
    $('login-pass').value = '';
    await start();
  } catch (e) { $('login-error').textContent = e.message; }
}
async function start() {
  const res = await fetch('/api/state');
  if (res.status === 401) return showLogin();
  const data = await res.json();
  document.body.classList.add('logged-in');
  if (!res.ok) { toast(data.error || 'Error cargando los datos.', true); return; }
  setState(data);
}

/* ================= navegación ================= */

function showTab(tab) {
  tabActual = tab;
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
  try { localStorage.setItem('kasa-tab', tab); } catch { /* sin storage */ }
  render();
  window.scrollTo(0, 0);
}
const RENDER = {};
function render() {
  if (!S) return;
  (RENDER[tabActual] || (() => {}))();
}

const familias = tipo => S.familias.filter(f => f.tipo === tipo).map(f => f.nombre).sort((a, b) => a.localeCompare(b));
function opcionesProductos(incluirInactivos) {
  const list = S.productos.filter(p => incluirInactivos || p.activo)
    .sort((a, b) => (a.categoria || 'zz').localeCompare(b.categoria || 'zz') || a.nombre.localeCompare(b.nombre));
  const grupos = new Map();
  list.forEach(p => {
    const g = p.categoria || 'Sin familia';
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push({ value: p.id, label: p.nombre + (p.unidad ? ` (${p.unidad})` : '') + (p.activo ? '' : ' — inactivo') });
  });
  return [...grupos].map(([group, options]) => ({ group, options }));
}
function refreshListas() {
  const opts = (arr) => arr.map(x => `<option value="${esc(x)}">`).join('');
  $('dl-clientes').innerHTML = opts([...S.clientes].map(c => c.nombre).sort());
  $('dl-proveedores').innerHTML = opts([...new Set(S.gastos.map(g => g.proveedor).filter(Boolean))].sort());
  $('dl-conceptos').innerHTML = opts([...new Set(S.otrosIngresos.map(o => o.concepto))].sort());
  fillSelect($('p-prod'), opcionesProductos(false), 'Elegí un producto');
  fillSelect($('a-prod'), opcionesProductos(true), 'Elegí un producto');
  fillSelect($('rc-prod'), opcionesProductos(true), 'Elegí un producto');
  fillSelect($('g-cat'), S.categoriasGasto.map(c => c.nombre), 'Elegí la categoría');
  fillSelect($('mp-familia'), familias('producto'), 'Sin familia');
  fillSelect($('mp-filtro-fam'), familias('producto'), 'Todas');
  fillSelect($('mi-familia'), familias('insumo'), 'Sin familia');
  fillSelect($('mi-filtro-fam'), familias('insumo'), 'Todas');
  fillSelect($('cat-grupo'), ['Mercadería', 'Fijos', 'Otros']);
}
const prodNombre = id => (C.idx.productos.get(id) || {}).nombre || '(borrado)';
const cliNombre = id => id ? ((C.idx.clientes.get(id) || {}).nombre || '(borrado)') : '';
const costoU = id => { const c = C.costos.get(id); return c ? c.costoUnit : null; };

function problemasTxt(c) {
  if (!c) return '';
  if (c.problemas.length) return `<span class="chip pend">${esc(c.problemas.join(', '))}</span>`;
  if (c.avisos.length) return `<span class="chip warn" title="${esc(c.avisos.join(', '))}">incompleto</span>`;
  return '';
}

/* ================= INICIO ================= */

let inicioMes = null;
RENDER.inicio = function () {
  inicioMes = inicioMes || mesActual();
  $('inicio-mes').value = inicioMes;
  const r = Calc.resumen(S, Calc.rangoMes(inicioMes));
  const pendTotal = Calc.sum(S.ventas.filter(v => v.estadoPago === 'pendiente'), v => v.total);
  const kpi = (label, value, foot, cls) => `<div class="kpi"><div class="label">${label}</div><div class="value num ${cls || ''}">${value}</div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
  $('inicio-kpis').innerHTML =
    kpi('Ventas', fmt(r.ventasTotal), `${r.cantVentas} venta${r.cantVentas === 1 ? '' : 's'}`) +
    kpi('Egresos', fmt(r.gastosTotal), `Mercadería ${fmt(r.porGrupo['Mercadería'])}`) +
    kpi('Resultado', fmt(r.resultadoFinal), r.otrosIngresos ? `incluye otros ingresos ${fmt(r.otrosIngresos)}` : 'ventas − egresos', r.resultadoFinal < 0 ? 'bad' : 'good') +
    kpi('Margen teórico', pct(r.margenTeorico), r.ingresoConCosto ? `${fmt(r.gananciaTeorica)} sobre ${fmt(r.ingresoConCosto)}` : 'sin ventas con productos') +
    kpi('Por cobrar', fmt(pendTotal), 'todas las fechas', pendTotal > 0 ? 'warn' : '');

  const alertas = [];
  const st = id => (C.stock.get(id) || { stock: 0 }).stock;
  const negativos = S.productos.filter(p => st(p.id) < 0);
  if (negativos.length) alertas.push(['bad', `${negativos.length} producto${negativos.length === 1 ? '' : 's'} con stock negativo (se vendió más de lo que figura producido). <button class="link" data-goto="stock">Ver stock</button>`]);
  const bajos = S.productos.filter(p => p.activo && p.stockMinimo !== null && st(p.id) >= 0 && st(p.id) < p.stockMinimo);
  if (bajos.length) alertas.push(['', `Stock bajo el mínimo: ${bajos.map(p => esc(p.nombre)).join(', ')}.`]);
  const lista = (arr) => arr.slice(0, 6).map(p => esc(p.nombre)).join(', ') + (arr.length > 6 ? '…' : '');
  const sinCosto = S.productos.filter(p => p.activo && costoU(p.id) === null);
  if (sinCosto.length) alertas.push(['', `${sinCosto.length} producto${sinCosto.length === 1 ? '' : 's'} sin costo (falta receta o rinde): ${lista(sinCosto)}. <button class="link" data-goto="recetario">Ir al recetario</button>`]);
  const sinPrecio = S.productos.filter(p => p.activo && !(p.precio > 0));
  if (sinPrecio.length) alertas.push(['', `Sin precio de venta: ${lista(sinPrecio)}. <button class="link" data-goto="maestros">Datos maestros</button>`]);
  const perdida = S.productos.filter(p => p.activo && p.precio > 0 && costoU(p.id) !== null && costoU(p.id) >= p.precio);
  if (perdida.length) alertas.push(['bad', `Precio por debajo del costo: ${perdida.map(p => esc(p.nombre)).join(', ')}.`]);
  const sinFamIns = S.insumos.filter(i => !i.familia).length;
  if (sinFamIns) alertas.push(['', `${sinFamIns} insumos sin familia. <button class="link" data-goto="maestros" data-dm="insumos">Asignar</button>`]);
  if (r.ventasSinDetalle > 0) alertas.push(['', `${fmt(r.ventasSinDetalle)} de ventas del mes no tienen productos cargados: no descuentan stock ni entran en el margen.`]);
  const gPend = Calc.sum(S.gastos.filter(g => g.estadoPago === 'pendiente'), g => g.monto);
  if (gPend > 0) alertas.push(['', `Egresos a pagar: ${fmt(gPend)}.`]);
  $('inicio-alertas').innerHTML = alertas.length
    ? alertas.map(([cls, t]) => `<div class="alert ${cls}">${t}</div>`).join('')
    : '<div class="empty">Todo en orden.</div>';

  const top = Calc.porProducto(S, Calc.rangoMes(inicioMes)).slice(0, 8);
  const max = Math.max(1, ...top.map(t => t.ingresos));
  $('inicio-top').innerHTML = top.length ? `<thead><tr><th>Producto</th><th class="amt">Cant.</th><th class="amt">Ingresos</th><th class="hide-sm"></th><th class="amt">Margen</th></tr></thead><tbody>` +
    top.map(t => `<tr><td>${esc(prodNombre(t.productoId))}</td><td class="amt num">${fmtQ(t.cantidad)}</td><td class="amt num">${fmt(t.ingresos)}</td>
      <td class="hide-sm" style="width:30%"><span class="bar" style="width:${Math.round(t.ingresos / max * 100)}%"></span></td><td class="amt num">${pct(t.margen)}</td></tr>`).join('') + '</tbody>' : '';
  $('inicio-top-empty').style.display = top.length ? 'none' : '';
};

/* ================= INGRESOS: ventas ================= */

let ingVista = 'ventas';
let ventaItems = [];       // renglones del formulario: {productoId, cantidad, precioUnit, precioTocado}
let ventaEstado = 'pagado';
let ventaEditId = null;
let ventasMes = null;

function clienteDelForm() {
  const n = $('v-cliente').value.trim().toLowerCase();
  return n ? S.clientes.find(c => c.nombre.toLowerCase() === n) || null : null;
}
function esMayorista() {
  const c = clienteDelForm();
  return c ? c.tipo === 'Mayorista' : ($('v-cliente').value.trim() && $('v-cliente-tipo').value === 'Mayorista');
}
function precioPara(p) {
  if (!p) return null;
  if (esMayorista() && p.precioMayorista > 0) return p.precioMayorista;
  return p.precio;
}
function nuevoRenglon() { return { productoId: '', cantidad: 1, precioUnit: null, precioTocado: false }; }

function renderVentaForm() {
  const opts = opcionesProductos(false);
  $('v-items').innerHTML = ventaItems.map((it, i) => {
    const p = C.idx.productos.get(it.productoId);
    const st = p ? (C.stock.get(p.id) || {}).stock : null;
    let sub = '';
    if (p) {
      const partes = [];
      if (st !== null && st !== undefined) partes.push(`Stock: ${fmtQ(st)}${p.unidad ? ' ' + esc(p.unidad) : ''}${st - it.cantidad < 0 ? ' <span class="warn">(no alcanza)</span>' : ''}`);
      partes.push(`Subtotal ${fmt((it.cantidad || 0) * (it.precioUnit || 0))}`);
      sub = `<div class="sub">${partes.join(' · ')}</div>`;
    }
    const optsHtml = opts.map(g => `<optgroup label="${esc(g.group)}">${g.options.map(o => `<option value="${esc(o.value)}"${o.value === it.productoId ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</optgroup>`).join('');
    const extra = p && !p.activo ? `<option value="${esc(p.id)}" selected>${esc(p.nombre)} (inactivo)</option>` : '';
    return `<div class="item" data-i="${i}">
      <select data-f="productoId" aria-label="Producto"><option value="">Producto…</option>${extra}${optsHtml}</select>
      <input type="number" data-f="cantidad" value="${it.cantidad ?? ''}" min="0" step="0.5" inputmode="decimal" aria-label="Cantidad">
      <input type="number" data-f="precioUnit" value="${it.precioUnit ?? ''}" min="0" step="1" inputmode="decimal" aria-label="Precio unitario" placeholder="Precio">
      <button class="x" data-quitar="${i}" aria-label="Quitar">×</button>${sub}</div>`;
  }).join('');
  $('v-total').textContent = fmt(Calc.sum(ventaItems, it => (it.cantidad || 0) * (it.precioUnit || 0)));
  setSeg('v-estado', ventaEstado);
  const c = clienteDelForm();
  const nombre = $('v-cliente').value.trim();
  $('v-cliente-tipo-wrap').style.display = nombre && !c ? '' : 'none';
  if (c) {
    const pend = Calc.sum(S.ventas.filter(v => v.clienteId === c.id && v.estadoPago === 'pendiente' && v.id !== ventaEditId), v => v.total);
    $('v-cliente-info').innerHTML = `${esc(c.tipo)}${pend > 0 ? ` · <span class="warn">debe ${fmt(pend)}</span>` : ''}`;
  } else $('v-cliente-info').textContent = nombre ? 'Cliente nuevo: se agrega a la lista al guardar.' : '';
}
function resetVentaForm() {
  ventaEditId = null;
  ventaItems = [nuevoRenglon()];
  ventaEstado = 'pagado';
  $('v-fecha').value = hoy();
  $('v-cliente').value = '';
  $('v-nota').value = '';
  $('v-medio').value = 'Transferencia';
  $('venta-titulo').textContent = 'Nueva venta';
  $('v-cancelar').style.display = 'none';
  $('venta-panel').classList.remove('editing');
  renderVentaForm();
}
function editarVenta(id) {
  const v = S.ventas.find(x => x.id === id);
  if (!v) return;
  const items = S.ventaItems.filter(i => i.ventaId === id);
  if (!items.length) {
    toast('Esta venta vino de la planilla vieja sin productos: no se puede editar el detalle. Podés borrarla y cargarla de nuevo.', true);
    return;
  }
  ventaEditId = id;
  ventaItems = items.map(i => ({ productoId: i.productoId, cantidad: i.cantidad, precioUnit: i.precioUnit, precioTocado: true }));
  ventaEstado = v.estadoPago;
  $('v-fecha').value = v.fecha;
  $('v-cliente').value = cliNombre(v.clienteId);
  $('v-nota').value = v.nota || '';
  $('v-medio').value = v.medioPago || '';
  $('venta-titulo').textContent = 'Editando venta del ' + fDate(v.fecha);
  $('v-cancelar').style.display = '';
  $('venta-panel').classList.add('editing');
  renderVentaForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function guardarVenta() {
  const items = ventaItems.filter(it => it.productoId);
  if (!items.length) return toast('Agregá al menos un producto.', true);
  if (items.some(it => !(it.cantidad > 0))) return toast('Revisá las cantidades.', true);
  if (items.some(it => it.precioUnit === null || it.precioUnit === '' || isNaN(it.precioUnit))) return toast('Falta el precio de algún producto.', true);
  const nombre = $('v-cliente').value.trim();
  const c = clienteDelForm();
  const body = {
    fecha: $('v-fecha').value,
    clienteId: c ? c.id : undefined,
    clienteNombre: c ? undefined : nombre,
    clienteTipo: c ? undefined : $('v-cliente-tipo').value,
    items: items.map(it => ({ productoId: it.productoId, cantidad: it.cantidad, precioUnit: it.precioUnit })),
    estadoPago: ventaEstado,
    medioPago: $('v-medio').value || null,
    nota: $('v-nota').value
  };
  if (ventaEditId) await api('PUT', '/api/ventas/' + ventaEditId, body);
  else await api('POST', '/api/ventas', body);
  toast(ventaEditId ? 'Venta actualizada.' : 'Venta guardada.');
  const fecha = body.fecha;
  resetVentaForm();
  $('v-fecha').value = fecha; // se suelen cargar varias del mismo día
  ventasMes = fecha.slice(0, 7);
  render();
}
function detalleVenta(v) {
  const items = C.idx.itemsPorVenta.get(v.id) || [];
  if (!items.length) return '<span class="muted">sin detalle</span>';
  return items.map(i => `${fmtQ(i.cantidad)} ${esc(prodNombre(i.productoId))}`).join(', ');
}

/* ================= INGRESOS: otros ================= */

let oiEditId = null, oiMes = null;
function resetOiForm() {
  oiEditId = null;
  $('oi-fecha').value = hoy();
  ['oi-concepto', 'oi-monto', 'oi-nota'].forEach(id => { $(id).value = ''; });
  $('oi-medio').value = 'Transferencia';
  $('oi-titulo').textContent = 'Otro ingreso';
  $('oi-cancelar').style.display = 'none';
  $('oi-panel').classList.remove('editing');
}
async function guardarOi() {
  const body = { fecha: $('oi-fecha').value, concepto: $('oi-concepto').value, monto: numVal('oi-monto'), medioPago: $('oi-medio').value || null, nota: $('oi-nota').value };
  if (!body.concepto.trim()) return toast('Poné el concepto.', true);
  if (!(body.monto > 0)) return toast('Poné el monto.', true);
  if (oiEditId) await api('PUT', '/api/otros-ingresos/' + oiEditId, body);
  else await api('POST', '/api/otros-ingresos', body);
  toast('Ingreso guardado.');
  oiMes = body.fecha.slice(0, 7);
  resetOiForm();
  render();
}

RENDER.ingresos = function () {
  setSeg('ing-seg', ingVista);
  $('ing-ventas').style.display = ingVista === 'ventas' ? '' : 'none';
  $('ing-otros').style.display = ingVista === 'otros' ? '' : 'none';
  if (ingVista === 'otros') {
    oiMes = oiMes || mesActual();
    $('oi-mes').value = oiMes;
    if (!$('oi-fecha').value) resetOiForm();
    const list = S.otrosIngresos.filter(o => o.fecha.startsWith(oiMes)).sort((a, b) => b.fecha.localeCompare(a.fecha));
    $('tbl-oi').innerHTML = list.map(o => `<tr><td class="num">${fDate(o.fecha)}</td><td>${esc(o.concepto)}${o.nota ? `<div class="hint">${esc(o.nota)}</div>` : ''}</td>
      <td class="amt num">${fmt(o.monto)}</td>
      <td class="amt"><button class="btn ghost small" data-editoi="${o.id}">Editar</button><button class="btn ghost small" data-borraroi="${o.id}">Borrar</button></td></tr>`).join('') +
      (list.length ? `<tr class="total"><td colspan="2">Total</td><td class="amt num">${fmt(Calc.sum(list, o => o.monto))}</td><td></td></tr>` : '');
    $('oi-empty').style.display = list.length ? 'none' : '';
    return;
  }
  ventasMes = ventasMes || mesActual();
  $('ventas-mes').value = ventasMes;
  if (!ventaItems.length) resetVentaForm(); else renderVentaForm();
  const soloPend = $('ventas-pend').checked;
  const list = S.ventas.filter(v => soloPend ? v.estadoPago === 'pendiente' : v.fecha.startsWith(ventasMes))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || '').localeCompare(a.creado || ''));
  const total = Calc.sum(list, v => v.total), pend = Calc.sum(list.filter(v => v.estadoPago === 'pendiente'), v => v.total);
  $('ventas-resumen').innerHTML = list.length ? `${list.length} ventas · ${fmt(total)}${pend > 0 ? ` · <span class="warn">pendiente ${fmt(pend)}</span>` : ''}` : '';
  $('tbl-ventas').innerHTML = list.map(v => `<tr>
      <td class="num">${fDate(v.fecha)}</td>
      <td>${esc(cliNombre(v.clienteId)) || '<span class="muted">—</span>'}</td>
      <td>${detalleVenta(v)}${v.nota ? `<div class="hint">${esc(v.nota)}</div>` : ''}</td>
      <td class="amt num">${fmt(v.total)}</td>
      <td><button class="chip ${v.estadoPago === 'pagado' ? 'ok' : 'pend'}" data-cobro="${v.id}" title="Cambiar estado">${v.estadoPago === 'pagado' ? 'Cobrada' : 'Pendiente'}</button>
        ${v.medioPago ? `<div class="hint">${esc(v.medioPago)}</div>` : ''}</td>
      <td class="amt"><button class="btn ghost small" data-editv="${v.id}">Editar</button><button class="btn ghost small" data-borrarv="${v.id}">Borrar</button></td>
    </tr>`).join('');
  $('ventas-empty').style.display = list.length ? 'none' : '';
  $('ventas-empty').textContent = soloPend ? 'No hay ventas pendientes de cobro.' : 'No hay ventas en este mes.';
};

/* ================= EGRESOS ================= */

let gastoEditId = null, gastosMes = null;
function resetGastoForm() {
  gastoEditId = null;
  $('g-fecha').value = hoy();
  ['g-monto', 'g-nota', 'g-prov'].forEach(id => { $(id).value = ''; });
  $('g-estado').value = 'pagado';
  $('g-medio').value = 'Transferencia';
  $('gasto-titulo').textContent = 'Nuevo egreso';
  $('g-cancelar').style.display = 'none';
  $('gasto-panel').classList.remove('editing');
}
function editarGasto(id) {
  const g = S.gastos.find(x => x.id === id);
  if (!g) return;
  gastoEditId = id;
  $('g-fecha').value = g.fecha;
  $('g-cat').value = g.categoria;
  $('g-monto').value = g.monto;
  $('g-medio').value = g.medioPago || '';
  $('g-estado').value = g.estadoPago;
  $('g-prov').value = g.proveedor || '';
  $('g-nota').value = g.nota || '';
  $('gasto-titulo').textContent = 'Editando egreso del ' + fDate(g.fecha);
  $('g-cancelar').style.display = '';
  $('gasto-panel').classList.add('editing');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function guardarGasto() {
  const body = {
    fecha: $('g-fecha').value, categoria: $('g-cat').value, monto: numVal('g-monto'),
    medioPago: $('g-medio').value || null, estadoPago: $('g-estado').value, proveedor: $('g-prov').value, nota: $('g-nota').value
  };
  if (!body.categoria) return toast('Elegí la categoría.', true);
  if (!(body.monto > 0)) return toast('Poné el monto.', true);
  if (gastoEditId) await api('PUT', '/api/gastos/' + gastoEditId, body);
  else await api('POST', '/api/gastos', body);
  toast(gastoEditId ? 'Egreso actualizado.' : 'Egreso guardado.');
  const { fecha, categoria } = body;
  resetGastoForm();
  $('g-fecha').value = fecha;
  $('g-cat').value = categoria;
  gastosMes = fecha.slice(0, 7);
  render();
}
RENDER.egresos = function () {
  gastosMes = gastosMes || mesActual();
  $('gastos-mes').value = gastosMes;
  if (!$('g-fecha').value) resetGastoForm();
  const list = S.gastos.filter(g => g.fecha.startsWith(gastosMes)).sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || '').localeCompare(a.creado || ''));
  const r = Calc.resumen(S, Calc.rangoMes(gastosMes));
  const cats = Object.entries(r.porCategoria).sort((a, b) => b[1] - a[1]);
  $('gastos-cats').innerHTML = list.length
    ? `<div class="kpis">${cats.map(([c, m]) => `<div class="kpi"><div class="label">${esc(c)}</div><div class="value num" style="font-size:17px">${fmt(m)}</div></div>`).join('')}
       <div class="kpi"><div class="label">Total</div><div class="value num" style="font-size:17px">${fmt(r.gastosTotal)}</div></div></div>` : '';
  $('tbl-gastos').innerHTML = list.map(g => `<tr>
      <td class="num">${fDate(g.fecha)}</td>
      <td>${esc(g.categoria)}${g.estadoPago === 'pendiente' ? ' <span class="chip pend">a pagar</span>' : ''}</td>
      <td>${esc([g.proveedor, g.nota].filter(Boolean).join(' · ')) || '<span class="muted">—</span>'}</td>
      <td class="amt num">${fmt(g.monto)}</td>
      <td class="amt"><button class="btn ghost small" data-editg="${g.id}">Editar</button><button class="btn ghost small" data-borrarg="${g.id}">Borrar</button></td>
    </tr>`).join('');
  $('gastos-empty').style.display = list.length ? 'none' : '';
};

/* ================= PRODUCCIÓN ================= */

let prodMes = null;
function renderProdInfo() {
  const p = C.idx.productos.get($('p-prod').value);
  if (!p) { $('p-info').textContent = ''; $('p-cant-label').textContent = 'Cantidad'; $('p-calc').style.display = 'none'; return; }
  $('p-cant-label').textContent = `Cantidad${p.unidad ? ' (' + p.unidad + ')' : ''}`;
  const c = C.costos.get(p.id);
  const partes = [];
  if (p.tipo === 'reventa') partes.push('Producto de reventa: cargá lo que compraste.');
  else if (p.rinde) partes.push(`Una tanda de la receta rinde ${fmtQ(p.rinde)}${p.unidad ? ' ' + esc(p.unidad) : ''}.`);
  if (!c || c.costoUnit === null) partes.push(`<span class="warn">Sin costo calculado (${esc((c && c.problemas.join(', ')) || '')}). <button class="link" data-goto="recetario">Completar receta</button></span>`);
  partes.push(`Stock actual: ${fmtQ((C.stock.get(p.id) || {}).stock)}.`);
  $('p-info').innerHTML = partes.join(' ');
  const cant = numVal('p-cant');
  const cu = c ? c.costoUnit : null;
  const box = (l, v) => `<div><div class="l">${l}</div><div class="v num">${v}</div></div>`;
  $('p-calc').style.display = cu === null ? 'none' : '';
  $('p-calc').innerHTML = box(`Costo por ${esc(p.unidad || 'unidad')}`, fmt(cu)) +
    box('Costo productivo', cant > 0 ? fmt(cu * cant) : '—') +
    box('Tandas', p.rinde > 0 && cant > 0 ? fmtQ(cant / p.rinde) : '—');
}
async function guardarProduccion() {
  const body = { fecha: $('p-fecha').value, productoId: $('p-prod').value, cantidad: numVal('p-cant'), nota: $('p-nota').value };
  if (!body.productoId) return toast('Elegí el producto.', true);
  if (!(body.cantidad > 0)) return toast('Poné la cantidad.', true);
  await api('POST', '/api/producciones', body);
  toast(`Listo: +${fmtQ(body.cantidad)} ${prodNombre(body.productoId)} al stock.`);
  $('p-cant').value = '';
  $('p-nota').value = '';
  prodMes = body.fecha.slice(0, 7);
  render();
}
RENDER.produccion = function () {
  prodMes = prodMes || mesActual();
  $('prod-mes').value = prodMes;
  if (!$('p-fecha').value) $('p-fecha').value = hoy();
  renderProdInfo();
  const list = S.producciones.filter(p => p.fecha.startsWith(prodMes)).sort((a, b) => b.fecha.localeCompare(a.fecha));
  $('tbl-prod').innerHTML = list.map(p => {
    const u = (C.idx.productos.get(p.productoId) || {}).unidad;
    return `<tr><td class="num">${fDate(p.fecha)}</td><td>${esc(prodNombre(p.productoId))}${p.nota ? `<div class="hint">${esc(p.nota)}</div>` : ''}</td>
      <td class="amt num">${fmtQ(p.cantidad)}${u ? ` <span class="hint">${esc(u)}</span>` : ''}</td><td class="amt num">${fmt(p.costoUnit)}</td>
      <td class="amt num">${p.costoUnit === null ? '—' : fmt(p.costoUnit * p.cantidad)}</td>
      <td class="amt"><button class="btn ghost small" data-borrarp="${p.id}">Borrar</button></td></tr>`;
  }).join('') +
    (list.length ? `<tr class="total"><td colspan="4">Costo productivo del mes</td><td class="amt num">${fmt(Calc.sum(list.filter(p => p.costoUnit !== null), p => p.costoUnit * p.cantidad))}</td><td></td></tr>` : '');
  $('prod-empty').style.display = list.length ? 'none' : '';
};

/* ================= STOCK ================= */

let modoConteo = false;
RENDER.stock = function () {
  if (!$('a-fecha').value) $('a-fecha').value = hoy();
  if (!$('s-conteo-fecha').value) $('s-conteo-fecha').value = hoy();
  const todos = $('s-todos').checked || modoConteo;
  const list = [...S.productos].filter(p => {
    const s = C.stock.get(p.id);
    return todos ? (p.activo || s.stock !== 0) : (s.producido || s.vendido || s.ajustado);
  }).sort((a, b) => (a.categoria || 'zz').localeCompare(b.categoria || 'zz') || a.nombre.localeCompare(b.nombre));
  const negativos = list.filter(p => C.stock.get(p.id).stock < 0).length;
  $('stock-alerta').innerHTML = negativos && !modoConteo
    ? `<div class="alert bad">${negativos} productos dan negativo: hay ventas sin la producción cargada (la mayoría viene de la planilla vieja). Hacé un <b>conteo</b> para arrancar con el stock real.</div>` : '';
  $('s-conteo-box').style.display = modoConteo ? '' : 'none';
  $('s-conteo-btn').style.display = modoConteo ? 'none' : '';
  let cat = null, html = '', valor = 0;
  list.forEach(p => {
    const s = C.stock.get(p.id);
    if ((p.categoria || 'Sin familia') !== cat) { cat = p.categoria || 'Sin familia'; html += `<tr class="cat"><td colspan="7">${esc(cat)}</td></tr>`; }
    const cu = costoU(p.id);
    const v = cu !== null && s.stock > 0 ? cu * s.stock : null;
    if (v) valor += v;
    const cls = s.stock < 0 ? 'bad' : (p.stockMinimo !== null && s.stock < p.stockMinimo ? 'warn' : '');
    html += `<tr>
      <td>${esc(p.nombre)}${p.unidad ? ` <span class="hint">${esc(p.unidad)}</span>` : ''}${p.activo ? '' : ' <span class="chip neutral">inactivo</span>'}</td>
      <td class="amt num ${cls}">${modoConteo ? `<input type="number" class="inline" data-conteo="${p.id}" value="${s.stock}" step="0.5" inputmode="decimal">` : fmtQ(s.stock)}</td>
      <td class="amt num hide-sm">${fmtQ(s.producido)}</td><td class="amt num hide-sm">${fmtQ(s.vendido)}</td><td class="amt num hide-sm">${fmtQ(s.ajustado)}</td>
      <td class="amt num">${v === null ? '—' : fmt(v)}</td>
      <td class="amt">${modoConteo ? '' : `<button class="btn ghost small" data-ajustar="${p.id}">Ajustar</button>`}</td></tr>`;
  });
  html += `<tr class="total"><td colspan="5">Valor del stock al costo</td><td class="amt num">${fmt(valor)}</td><td></td></tr>`;
  $('tbl-stock').innerHTML = html;
  const aj = [...S.ajustes].sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || '').localeCompare(a.creado || '')).slice(0, 30);
  $('tbl-ajustes').innerHTML = aj.map(a => `<tr><td class="num">${fDate(a.fecha)}</td><td>${esc(prodNombre(a.productoId))}${a.nota ? `<div class="hint">${esc(a.nota)}</div>` : ''}</td>
    <td class="amt num ${a.cantidad < 0 ? 'bad' : 'good'}">${a.cantidad > 0 ? '+' : ''}${fmtQ(a.cantidad)}</td><td>${esc(a.motivo)}</td>
    <td class="amt"><button class="btn ghost small" data-borrara="${a.id}">Borrar</button></td></tr>`).join('');
  $('ajustes-empty').style.display = aj.length ? 'none' : '';
};
async function guardarConteo() {
  const conteos = [...document.querySelectorAll('[data-conteo]')].map(inp => ({
    productoId: inp.dataset.conteo, stockReal: inp.value.trim() === '' ? null : Number(inp.value.replace(',', '.'))
  })).filter(c => c.stockReal !== null && Calc.round2(c.stockReal) !== C.stock.get(c.productoId).stock);
  if (!conteos.length) { modoConteo = false; render(); return toast('No cambiaste ningún número.'); }
  const fecha = $('s-conteo-fecha').value;
  if (fecha !== hoy() && !confirm(`El conteo va con fecha ${fDate(fecha)}: la diferencia se calcula contra el stock a esa fecha. ¿Seguimos?`)) return;
  const r = await api('POST', '/api/stock/conteo', { fecha, conteos, nota: 'Conteo físico' });
  modoConteo = false;
  toast(`Conteo guardado: ${r.ajustes} ajuste${r.ajustes === 1 ? '' : 's'}.`);
  render();
}
async function guardarAjuste() {
  const body = { fecha: $('a-fecha').value, productoId: $('a-prod').value, cantidad: numVal('a-cant'), motivo: $('a-motivo').value, nota: $('a-nota').value };
  if (!body.productoId) return toast('Elegí el producto.', true);
  if (!body.cantidad) return toast('Poné la cantidad (negativa si sale del stock).', true);
  await api('POST', '/api/ajustes', body);
  toast('Ajuste guardado.');
  $('a-cant').value = '';
  $('a-nota').value = '';
}

/* ================= PANEL DE CONTROL ================= */

let pnVista = 'ventas', pcVista = 'insumo';
let pvLimite = 40;   // grupos visibles en la tabla de ventas ("ver más" suma de a 40)
const pvAbiertos = new Set();

function rangoPanel() {
  const p = $('pn-periodo').value, h = hoy();
  let r;
  if (p === 'mes') r = Calc.rangoMes(h.slice(0, 7));
  else if (p === 'mesAnt') r = Calc.rangoMes(moverMes(h.slice(0, 7), -1));
  else if (p === 'anio') r = Calc.rangoAnio(h.slice(0, 4));
  else if (p === 'anioAnt') r = Calc.rangoAnio(String(Number(h.slice(0, 4)) - 1));
  else r = { desde: $('pn-desde').value || h.slice(0, 7) + '-01', hasta: $('pn-hasta').value || h };
  if (r.desde > r.hasta) r = { desde: r.hasta, hasta: r.desde };
  if (p !== 'custom') { $('pn-desde').value = r.desde; $('pn-hasta').value = r.hasta; }
  return r;
}
function rangoComp(r) { return $('pn-comp').value === 'anioAnt' ? Calc.rangoAnioAnterior(r) : Calc.rangoAnterior(r); }
function rangoTxt(r) { return `${fDate(r.desde)} al ${fDate(r.hasta)}`; }

RENDER.panel = function () {
  setSeg('pn-seg', pnVista);
  ['ventas', 'costos', 'resultados'].forEach(v => { $('pn-' + v).style.display = pnVista === v ? '' : 'none'; });
  const r = rangoPanel(), rc = rangoComp(r);
  $('pn-rango').textContent = `Del ${rangoTxt(r)}` + (pnVista === 'resultados' ? ` · comparado con ${rangoTxt(rc)}` : '');
  if (pnVista === 'ventas') renderPanelVentas(r);
  else if (pnVista === 'costos') renderPanelCostos(r);
  else renderPanelResultados(r, rc);
};

const CLAVES_VENTA = { producto: 'Producto', familia: 'Familia', cliente: 'Cliente', tipoCliente: 'Tipo de cliente', mes: 'Mes' };
function clavesVenta() { return [...document.querySelectorAll('#pv-group input:checked')].map(i => i.value); }
function valorClave(k, v) { return k === 'mes' && /^\d{4}-\d{2}$/.test(v) ? mesLabel(v) : v; }
function filasPanelVentas(r) {
  const q = $('pv-buscar').value.trim().toLowerCase();
  const filas = Calc.ventasFilas(S, r);
  return q ? filas.filter(f => [f.producto, f.cliente, f.familia].some(x => String(x).toLowerCase().includes(q))) : filas;
}
function renderPanelVentas(r) {
  document.querySelectorAll('#pv-group label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
  const filas = filasPanelVentas(r);
  const claves = clavesVenta();
  const grupos = Calc.agrupar(filas, claves);
  const total = Calc.agrupar(filas, [])[0];
  const kpi = (label, value, foot) => `<div class="kpi"><div class="label">${label}</div><div class="value num">${value}</div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
  $('pv-kpis').innerHTML = total
    ? kpi('Ventas', fmt(total.ingreso), `${total.cantVentas} ventas`) +
      kpi('Ticket promedio', fmt(total.cantVentas ? total.ingreso / total.cantVentas : null)) +
      kpi('Ganancia teórica', fmt(total.ganancia), total.margen !== null ? `margen ${pct(total.margen)}` : '') +
      kpi('Clientes', new Set(filas.map(f => f.clienteId).filter(Boolean)).size)
    : kpi('Ventas', fmt(0), 'sin ventas en el período');
  const heads = claves.length ? claves.map(k => `<th>${CLAVES_VENTA[k]}</th>`).join('') : '<th>Total</th>';
  const ncols = Math.max(1, claves.length) + 6;
  let html = `<thead><tr>${heads}<th class="amt">Ventas</th><th class="amt">Cantidad</th><th class="amt">Ingresos</th><th class="amt hide-sm">Costo</th><th class="amt">Ganancia</th><th class="amt">Margen</th></tr></thead><tbody>`;
  grupos.slice(0, pvLimite).forEach(g => {
    const abierto = pvAbiertos.has(g.key);
    html += `<tr class="click" data-pvg="${esc(g.key)}">${(claves.length ? g.valores.map((v, i) => `<td>${i === 0 ? (abierto ? '▾ ' : '▸ ') : ''}${esc(valorClave(claves[i], v))}</td>`) : [`<td>${abierto ? '▾' : '▸'} Todas</td>`]).join('')}
      <td class="amt num">${g.cantVentas}</td><td class="amt num">${g.cantidad === null ? '—' : fmtQ(g.cantidad) + (g.unidad ? ` <span class="hint">${esc(g.unidad)}</span>` : '')}</td>
      <td class="amt num">${fmt(g.ingreso)}</td><td class="amt num hide-sm">${fmt(g.costo)}</td><td class="amt num">${fmt(g.ganancia)}</td>
      <td class="amt num ${g.margen !== null && g.margen < 0.3 ? 'bad' : ''}">${pct(g.margen)}</td></tr>`;
    if (abierto) {
      html += g.filas.slice().sort((a, b) => b.fecha.localeCompare(a.fecha)).map(f => `<tr class="detalle"><td colspan="${ncols}">${fDate(f.fecha)} · ${esc(f.cliente)} · ${esc(f.producto)}${f.cantidad !== null ? ` · ${fmtQ(f.cantidad)} × ${fmt(f.precioUnit)}` : ''} = <b>${fmt(f.ingreso)}</b></td></tr>`).join('');
    }
  });
  if (grupos.length > pvLimite) html += `<tr><td colspan="${ncols}"><button class="btn ghost small" id="pv-mas">Ver ${Math.min(40, grupos.length - pvLimite)} más (hay ${grupos.length} grupos)</button></td></tr>`;
  if (total) html += `<tr class="total"><td colspan="${Math.max(1, claves.length)}">Total</td><td class="amt num">${total.cantVentas}</td><td></td><td class="amt num">${fmt(total.ingreso)}</td><td class="amt num hide-sm">${fmt(total.costo)}</td><td class="amt num">${fmt(total.ganancia)}</td><td class="amt num">${pct(total.margen)}</td></tr>`;
  $('tbl-pv').innerHTML = html + '</tbody>';
  const sinDet = Calc.sum(filas.filter(f => !f.productoId), f => f.ingreso);
  $('pv-nota').innerHTML = (grupos.length ? 'Tocá una fila para ver el detalle. ' : 'No hay ventas en el período. ') +
    (sinDet ? `${fmt(sinDet)} son ventas sin productos cargados (aparecen como "(sin detalle)").` : '') +
    ' La cantidad solo se suma si todo el grupo está en la misma unidad.';
}
function exportarPanelVentas() {
  const r = rangoPanel(), claves = clavesVenta();
  const grupos = Calc.agrupar(filasPanelVentas(r), claves);
  const filas = [[...(claves.length ? claves.map(k => CLAVES_VENTA[k]) : ['Total']), 'Ventas', 'Cantidad', 'Unidad', 'Ingresos', 'Costo', 'Ganancia', 'Margen %']];
  grupos.forEach(g => filas.push([...(claves.length ? g.valores.map((v, i) => valorClave(claves[i], v)) : ['Todas']), g.cantVentas, g.cantidad, g.unidad || '', g.ingreso, g.costo, g.ganancia, g.margen === null ? null : g.margen * 100]));
  descargarCSV(`ventas_${r.desde}_${r.hasta}`, filas);
}

function renderPanelCostos(r) {
  setSeg('pc-chips', pcVista);
  const c = Calc.costosProduccion(S, r);
  const compras = Calc.resumen(S, r).porGrupo['Mercadería'];
  const kpi = (label, value, foot) => `<div class="kpi"><div class="label">${label}</div><div class="value num">${value}</div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
  $('pc-kpis').innerHTML =
    kpi('Costo productivo total', fmt(c.total), `${c.porProducto.length} productos producidos`) +
    kpi('Compras de mercadería', fmt(compras), 'egresos cargados, para comparar') +
    kpi('Insumos usados', c.porInsumo.filter(x => x.insumoId !== '__sin__').length);
  let html;
  if (pcVista === 'insumo') {
    const porFam = new Map();
    c.porInsumo.forEach(x => { if (!porFam.has(x.familia)) porFam.set(x.familia, []); porFam.get(x.familia).push(x); });
    const fams = [...porFam].map(([f, xs]) => ({ f, xs, t: Calc.sum(xs, x => x.costo) })).sort((a, b) => b.t - a.t);
    html = `<thead><tr><th>Insumo</th><th class="amt">Consumo</th><th class="hide-sm">Unidad</th><th class="amt">Costo</th><th class="amt">% del total</th></tr></thead><tbody>` +
      fams.map(({ f, xs, t }) => `<tr class="sub"><td>${esc(f)}</td><td></td><td class="hide-sm"></td><td class="amt num">${fmt(t)}</td><td class="amt num">${pct(c.total ? t / c.total : null)}</td></tr>` +
        xs.map(x => `<tr class="ind"><td>${esc(x.nombre)}</td><td class="amt num">${x.consumo ? fmtQ(Calc.round2(x.consumo)) : '—'}</td><td class="hide-sm">${esc(x.unidad || '')}</td><td class="amt num">${fmt(x.costo)}</td><td class="amt num">${pct(c.total ? x.costo / c.total : null)}</td></tr>`).join('')).join('');
  } else {
    html = `<thead><tr><th>Producto terminado</th><th class="amt">Producido</th><th class="amt">Costo unit. prom.</th><th class="amt">Costo total</th><th class="amt">% del total</th></tr></thead><tbody>` +
      c.porProducto.map(x => `<tr><td>${esc(x.nombre)} <span class="hint">${esc(x.familia)}</span></td><td class="amt num">${fmtQ(x.cantidad)}${x.unidad ? ` <span class="hint">${esc(x.unidad)}</span>` : ''}</td>
        <td class="amt num">${fmt(x.cantidad ? x.costo / x.cantidad : null)}</td><td class="amt num">${fmt(x.costo)}</td><td class="amt num">${pct(c.total ? x.costo / c.total : null)}</td></tr>`).join('');
  }
  html += `<tr class="total"><td colspan="3">Total</td><td class="amt num">${fmt(c.total)}</td><td></td></tr></tbody>`;
  $('tbl-pc').innerHTML = c.total ? html : '<tbody><tr><td class="empty">No hay producción con costo en el período.</td></tr></tbody>';
  $('pc-nota').innerHTML = [
    'El total sale del costo congelado de cada producción. Por insumo se reparte según la receta actual; el consumo es tandas producidas × cantidad de la receta.',
    c.sinCosto.length ? `<span class="warn">${c.sinCosto.length} producciones no tienen costo (su producto no tenía receta o rinde) y no suman acá.</span>` : ''
  ].join(' ');
}
function exportarPanelCostos() {
  const r = rangoPanel(), c = Calc.costosProduccion(S, r);
  const filas = pcVista === 'insumo'
    ? [['Familia', 'Insumo', 'Consumo', 'Unidad', 'Costo', '% del total'], ...c.porInsumo.map(x => [x.familia, x.nombre, x.consumo, x.unidad || '', x.costo, c.total ? x.costo / c.total * 100 : null])]
    : [['Producto', 'Familia', 'Producido', 'Unidad', 'Costo unit. prom.', 'Costo total', '% del total'], ...c.porProducto.map(x => [x.nombre, x.familia, x.cantidad, x.unidad || '', x.cantidad ? x.costo / x.cantidad : null, x.costo, c.total ? x.costo / c.total * 100 : null])];
  descargarCSV(`costos_${pcVista}_${r.desde}_${r.hasta}`, filas);
}

// Variación: sube bueno (ventas, resultado) o sube malo (egresos).
function delta(act, ant, subeEsBueno, esPct) {
  if (act === null || ant === null || act === undefined || ant === undefined) return '<span class="muted">sin comparación</span>';
  if (esPct) {
    const d = Math.round((act - ant) * 100);
    const cls = d === 0 ? 'muted' : (d > 0) === subeEsBueno ? 'good' : 'bad';
    return `<span class="delta ${cls}">${d > 0 ? '▲ +' : d < 0 ? '▼ ' : ''}${d} pts</span>`;
  }
  const d = act - ant;
  const cls = d === 0 ? 'muted' : (d > 0) === subeEsBueno ? 'good' : 'bad';
  const rel = ant ? ` (${d > 0 ? '+' : ''}${Math.round(d / Math.abs(ant) * 100)}%)` : '';
  return `<span class="delta ${cls}">${d > 0 ? '▲ ' : d < 0 ? '▼ ' : ''}${fmtC(d)}${rel}</span>`;
}
function renderPanelResultados(r, rc) {
  const a = Calc.resumen(S, r), b = Calc.resumen(S, rc);
  const kpi = (label, value, d, cls) => `<div class="kpi"><div class="label">${label}</div><div class="value num ${cls || ''}">${value}</div><div class="foot">${d} <span class="muted">vs. comparación</span></div></div>`;
  $('pr-kpis').innerHTML =
    kpi('Ventas', fmt(a.ventasTotal), delta(a.ventasTotal, b.ventasTotal, true)) +
    kpi('Egresos', fmt(a.gastosTotal), delta(a.gastosTotal, b.gastosTotal, false)) +
    kpi('Resultado', fmt(a.resultadoFinal), delta(a.resultadoFinal, b.resultadoFinal, true), a.resultadoFinal < 0 ? 'bad' : 'good') +
    kpi('Margen teórico', pct(a.margenTeorico), delta(a.margenTeorico, b.margenTeorico, true, true)) +
    kpi('Ticket promedio', fmt(a.ticketPromedio), delta(a.ticketPromedio, b.ticketPromedio, true));

  // Estado de resultados vertical, con el detalle por categoría dentro de cada grupo.
  const catsDe = (res, grupo) => Object.keys(res.porCategoria).filter(c => Calc.grupoDe(S, c) === grupo);
  const pctV = (x, v) => v ? pct(x / v) : '—';
  const linea = (label, x, y, cls, subeEsBueno = true) => `<tr class="${cls || ''}"><td>${label}</td><td class="amt num">${fmt(x)}</td><td class="amt num hide-sm">${fmt(y)}</td>
    <td class="amt">${cls === 'ind' ? '' : delta(x, y, subeEsBueno)}</td><td class="amt num hide-sm">${pctV(x, a.ventasTotal)}</td></tr>`;
  const grupoLineas = (grupo, label) => {
    const cats = [...new Set([...catsDe(a, grupo), ...catsDe(b, grupo)])].sort((x, y) => (a.porCategoria[y] || 0) - (a.porCategoria[x] || 0));
    return linea(`− ${label}`, a.porGrupo[grupo] || 0, b.porGrupo[grupo] || 0, 'sub', false) +
      cats.map(c => linea(esc(c), a.porCategoria[c] || 0, b.porCategoria[c] || 0, 'ind')).join('');
  };
  $('tbl-pr').innerHTML = `<thead><tr><th></th><th class="amt">Período</th><th class="amt hide-sm">Comparación</th><th class="amt">Variación</th><th class="amt hide-sm">% ventas</th></tr></thead><tbody>` +
    linea('<b>Ventas</b>', a.ventasTotal, b.ventasTotal, 'sub') +
    grupoLineas('Mercadería', 'Mercadería') +
    linea('<b>= Margen bruto</b>', a.margenBruto, b.margenBruto, 'total') +
    grupoLineas('Fijos', 'Gastos fijos') +
    grupoLineas('Otros', 'Otros egresos') +
    linea('<b>= Resultado operativo</b>', a.resultado, b.resultado, 'total') +
    (a.otrosIngresos || b.otrosIngresos ? linea('+ Otros ingresos', a.otrosIngresos, b.otrosIngresos) + linea('<b>= Resultado final</b>', a.resultadoFinal, b.resultadoFinal, 'total') : '') +
    `<tr><td colspan="5" style="padding-top:14px;" class="muted">Rentabilidad teórica (receta)</td></tr>` +
    linea('Ventas con productos', a.ingresoConCosto, b.ingresoConCosto) +
    linea('− Costo de lo vendido', a.costoVendido, b.costoVendido, '', false) +
    linea('<b>= Ganancia teórica</b>', a.gananciaTeorica, b.gananciaTeorica, 'total') + '</tbody>';

  // Tendencia: meses que terminan en el último mes del período (6 en el celular, 12 en pantalla ancha).
  const n = $('pr-chart').clientWidth < 560 ? 6 : 12;
  const data = Calc.tendencia(S, r.hasta.slice(0, 7), n);
  dibujarTendencia($('pr-chart'), data);
  $('pr-legend').innerHTML = `<span><i style="background:var(--c-ventas)"></i>Ventas</span><span><i style="background:var(--c-egresos)"></i>Egresos</span><span><i class="line" style="background:var(--c-resultado)"></i>Resultado</span>`;
  $('tbl-pr-meses').innerHTML = `<thead><tr><th>Mes</th><th class="amt">Ventas</th><th class="amt hide-sm">Mercadería</th><th class="amt hide-sm">Fijos</th><th class="amt hide-sm">Otros</th><th class="amt">Egresos</th><th class="amt">Resultado</th><th class="amt">Margen teór.</th></tr></thead><tbody>` +
    data.slice().reverse().map(m => `<tr><td>${mesLabel(m.mes)}</td><td class="amt num">${fmt(m.ventasTotal)}</td><td class="amt num hide-sm">${fmt(m.porGrupo['Mercadería'])}</td>
      <td class="amt num hide-sm">${fmt(m.porGrupo['Fijos'])}</td><td class="amt num hide-sm">${fmt(m.porGrupo['Otros'])}</td><td class="amt num">${fmt(m.gastosTotal)}</td>
      <td class="amt num ${m.resultadoFinal < 0 ? 'bad' : 'good'}">${fmt(m.resultadoFinal)}</td><td class="amt num">${pct(m.margenTeorico)}</td></tr>`).join('') + '</tbody>';
}

// Gráfico de tendencia en SVG, sin librerías: columnas de ventas y egresos (mismo eje en $),
// línea de resultado, etiquetas en la punta de las ventas y en cada punto del resultado,
// y tooltip por mes (tocar o pasar el mouse).
function nice(max) {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
// Halo del color de fondo para que las etiquetas se lean aunque pasen sobre una barra.
const HALO = 'stroke="#FFFBF8" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke"';
function dibujarTendencia(el, data) {
  const W = Math.max(300, el.clientWidth || 600), H = 280;
  const m = { t: 22, r: 10, b: 30, l: 50 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxV = Math.max(1, ...data.map(d => Math.max(d.ventasTotal, d.gastosTotal, d.resultadoFinal)));
  const minV = Math.min(0, ...data.map(d => d.resultadoFinal));
  const paso = nice((maxV - minV) / 4);
  const top = Math.ceil(maxV / paso) * paso, bot = Math.floor(minV / paso) * paso;
  const y = v => m.t + ih - (v - bot) / (top - bot) * ih;
  const band = iw / data.length;
  const bw = Math.min(22, band * 0.3);
  const cx = i => m.l + band * i + band / 2;
  const col = (x, v, color) => {
    const y0 = y(0), y1 = y(Math.max(0, v)), h = Math.max(0, y0 - y1), rr = Math.min(4, h);
    if (!h) return '';
    return `<path d="M${x} ${y0} V${y1 + rr} Q${x} ${y1} ${x + rr} ${y1} H${x + bw - rr} Q${x + bw} ${y1} ${x + bw} ${y1 + rr} V${y0} Z" fill="${color}"/>`;
  };
  let g = '';
  for (let v = bot; v <= top + 1e-6; v += paso) {
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? '#BFAFA8' : '#EDE3DE'}" stroke-width="1"/>`;
    g += `<text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#7A625B">${fmtC(v)}</text>`;
  }
  const cs = getComputedStyle(document.documentElement);
  const cV = cs.getPropertyValue('--c-ventas').trim(), cE = cs.getPropertyValue('--c-egresos').trim(), cR = cs.getPropertyValue('--c-resultado').trim();
  data.forEach((d, i) => {
    const x = cx(i);
    g += col(x - bw - 1, d.ventasTotal, cV) + col(x + 1, d.gastosTotal, cE);
    if (d.ventasTotal) g += `<text x="${x - bw / 2 - 1}" y="${y(d.ventasTotal) - 5}" text-anchor="middle" font-size="10.5" fill="#2B1A17" font-weight="600" ${HALO}>${fmtC(d.ventasTotal)}</text>`;
    g += `<text x="${x}" y="${H - 10}" text-anchor="middle" font-size="11.5" fill="#7A625B">${mesCorto(d.mes)}</text>`;
  });
  const pts = data.map((d, i) => [cx(i), y(d.resultadoFinal)]);
  g += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${cR}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach(([x, yy], i) => {
    g += `<circle cx="${x}" cy="${yy}" r="4.5" fill="${cR}" stroke="#FFFBF8" stroke-width="2"/>`;
    const v = data[i].resultadoFinal;
    g += `<text x="${x}" y="${yy + 17}" text-anchor="middle" font-size="10.5" fill="${v < 0 ? '#A3161C' : '#4F6B2E'}" font-weight="700" ${HALO}>${fmtC(v)}</text>`;
  });
  // zonas de hover por mes
  data.forEach((d, i) => { g += `<rect data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" fill="transparent"/>`; });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventas, egresos y resultado por mes">${g}</svg><div class="tip"></div>`;
  const tip = el.querySelector('.tip');
  const mostrar = (e) => {
    const t = e.target.closest('rect[data-i]');
    if (!t) { tip.style.opacity = 0; return; }
    const d = data[Number(t.dataset.i)];
    tip.innerHTML = `<b>${mesLabel(d.mes)}</b><i style="background:${cV}"></i>Ventas ${fmt(d.ventasTotal)}<br><i style="background:${cE}"></i>Egresos ${fmt(d.gastosTotal)}<br><i style="background:${cR}"></i>Resultado ${fmt(d.resultadoFinal)}`;
    const box = el.getBoundingClientRect();
    const x = (Number(t.getAttribute('x')) + band / 2) / W * box.width;
    tip.style.left = Math.min(Math.max(0, x - 80), box.width - 170) + 'px';
    tip.style.top = '0px';
    tip.style.opacity = 1;
  };
  el.onpointermove = mostrar;
  el.onpointerdown = mostrar;
  el.onpointerleave = () => { tip.style.opacity = 0; };
}

/* ================= RECETARIO ================= */

let receta = null;   // { productoId, lineas: [{insumoId, cantidad}] }
function cargarReceta(id) {
  receta = id ? { productoId: id, lineas: S.recetas.filter(l => l.productoId === id).map(l => ({ insumoId: l.insumoId, cantidad: l.cantidad })) } : null;
  const p = id ? C.idx.productos.get(id) : null;
  $('rc-prod').value = id || '';
  $('rc-editor').style.display = p ? '' : 'none';
  if (!p) return;
  $('rc-unidad').value = p.unidad || '';
  $('rc-rinde').value = p.rinde ?? '';
  fillSelect($('rc-copiar'), opcionesProductos(true).map(g => ({ group: g.group, options: g.options.filter(o => o.value !== id && S.recetas.some(l => l.productoId === o.value)) })).filter(g => g.options.length), 'Elegí otro producto');
  $('rc-copiar').value = '';
  renderRecetaLineas();
}
function renderRecetaLineas() {
  const ins = [...S.insumos].sort((a, b) => (a.familia || 'zz').localeCompare(b.familia || 'zz') || a.nombre.localeCompare(b.nombre));
  const grupos = new Map();
  ins.forEach(i => { const g = i.familia || 'Sin familia'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(i); });
  $('rc-receta').innerHTML = receta.lineas.map((l, i) => {
    const x = C.idx.insumos.get(l.insumoId);
    const opts = [...grupos].map(([g, xs]) => `<optgroup label="${esc(g)}">${xs.map(o => `<option value="${esc(o.id)}"${o.id === l.insumoId ? ' selected' : ''}>${esc(o.nombre)}${o.unidad ? ' (' + esc(o.unidad) + ')' : ''}</option>`).join('')}</optgroup>`).join('');
    return `<div class="item" data-i="${i}">
      <select data-f="insumoId" aria-label="Insumo"><option value="">Insumo…</option>${opts}</select>
      <input type="number" data-f="cantidad" value="${l.cantidad ?? ''}" min="0" step="any" inputmode="decimal" aria-label="Cantidad" placeholder="${x && x.unidad ? esc(x.unidad) : 'cant.'}">
      <span class="num amt" data-linea="${i}"></span>
      <button class="x" data-quitarr="${i}" aria-label="Quitar">×</button></div>`;
  }).join('') || '<div class="empty">Sin receta. Agregá los insumos de una tanda.</div>';
  renderRecetaCalc();
}
// Recalcula en vivo con lo que hay en el formulario (sin guardar), usando calc.js.
function renderRecetaCalc() {
  if (!receta) return;
  const p = C.idx.productos.get(receta.productoId);
  const rinde = numVal('rc-rinde');
  const tmpId = '__rc__';
  const st = { ...S, productos: [...S.productos, { id: tmpId, rinde, activo: true }], recetas: receta.lineas.filter(l => l.insumoId && l.cantidad > 0).map((l, i) => ({ id: 't' + i, productoId: tmpId, ...l })) };
  const c = Calc.costoProducto(st, tmpId);
  receta.lineas.forEach((l, i) => {
    const el = document.querySelector(`[data-linea="${i}"]`);
    const x = C.idx.insumos.get(l.insumoId);
    if (el) el.textContent = x && x.costo !== null && l.cantidad > 0 ? fmt(x.costo * l.cantidad) : (x && x.costo === null ? 'sin precio' : '');
  });
  const m = Calc.margen(p.precio, c.costoUnit);
  const sug = Calc.precioSugerido(c.costoUnit, p.recargo);
  const u = $('rc-unidad').value.trim() || 'unidad';
  const box = (l, v, cls) => `<div><div class="l">${l}</div><div class="v num ${cls || ''}">${v}</div></div>`;
  $('rc-calc').innerHTML =
    box('Costo de la tanda', fmt(c.costoTanda)) +
    box(`Costo por ${esc(u)}`, fmt(c.costoUnit)) +
    box('Precio de venta', fmt(p.precio)) +
    box('Precio sugerido', fmt(sug)) +
    box('Margen', m ? pct(m.margen) : '—', m && m.margen < 0.3 ? 'bad' : '');
  const faltan = [...c.problemas.filter(x => x !== 'producto inexistente'), ...c.avisos];
  $('rc-hint').innerHTML = (p.tipo === 'reventa'
    ? 'Reventa: la receta es lo que comprás (ej. 1 caja) y el rinde, cuántas unidades vendés de eso.'
    : 'Rinde: cuántas unidades de venta salen de una tanda (ej. 10 docenas). La cantidad de cada insumo va en su unidad (si el insumo está en kg, 30 g = 0,03).') +
    (faltan.length ? ` <span class="warn">Falta: ${esc(faltan.join('; '))}.</span>` : '');
}
async function guardarReceta() {
  const lineas = receta.lineas.filter(l => l.insumoId);
  if (lineas.some(l => !(l.cantidad > 0))) return toast('Revisá las cantidades de la receta.', true);
  await api('PUT', `/api/productos/${receta.productoId}/receta`, { unidad: $('rc-unidad').value, rinde: numVal('rc-rinde'), receta: lineas });
  toast('Receta guardada. Costo por unidad: ' + fmt(costoU(receta.productoId)));
}
RENDER.recetario = function () {
  if (receta && !C.idx.productos.get(receta.productoId)) receta = null;
  if (receta) { $('rc-prod').value = receta.productoId; renderRecetaCalc(); } else $('rc-editor').style.display = 'none';
  const list = [...S.productos].sort((a, b) => (a.categoria || 'zz').localeCompare(b.categoria || 'zz') || a.nombre.localeCompare(b.nombre));
  let cat = null, html = '';
  list.forEach(p => {
    const c = C.costos.get(p.id);
    const g = p.categoria || 'Sin familia';
    if (g !== cat) { cat = g; html += `<tr class="cat"><td colspan="5">${esc(g)}</td></tr>`; }
    html += `<tr class="click" data-receta="${p.id}"><td>${esc(p.nombre)}${p.activo ? '' : ' <span class="chip neutral">inactivo</span>'}</td><td class="amt num">${c.lineas.length}</td>
      <td class="amt num">${p.rinde === null ? '—' : fmtQ(p.rinde) + (p.unidad ? ` <span class="hint">${esc(p.unidad)}</span>` : '')}</td><td class="amt num">${fmt(c.costoUnit)}</td><td>${problemasTxt(c)}</td></tr>`;
  });
  $('tbl-recetas').innerHTML = html;
};

/* ================= DATOS MAESTROS ================= */

let dmVista = 'productos';
let mpEditId = null;       // producto en edición (null = nuevo)

RENDER.maestros = function () {
  setSeg('dm-seg', dmVista);
  ['productos', 'insumos', 'clientes', 'familias'].forEach(v => { $('dm-' + v).style.display = dmVista === v ? '' : 'none'; });
  ({ productos: renderMProductos, insumos: renderMInsumos, clientes: renderMClientes, familias: renderMFamilias })[dmVista]();
};

function renderMProductos() {
  const q = $('mp-buscar').value.trim().toLowerCase(), fam = $('mp-filtro-fam').value;
  const list = S.productos.filter(p => (!q || p.nombre.toLowerCase().includes(q)) && (!fam || p.categoria === fam))
    .sort((a, b) => (a.activo === b.activo ? 0 : a.activo ? -1 : 1) || (a.categoria || 'zz').localeCompare(b.categoria || 'zz') || a.nombre.localeCompare(b.nombre));
  let g0 = null, html = '';
  list.forEach(p => {
    const c = C.costos.get(p.id);
    const g = p.activo ? (p.categoria || 'Sin familia') : 'Inactivos';
    if (g !== g0) { g0 = g; html += `<tr class="cat"><td colspan="5">${esc(g)}</td></tr>`; }
    const m = Calc.margen(p.precio, c.costoUnit);
    html += `<tr class="click" data-editp="${p.id}">
      <td>${esc(p.nombre)}${p.unidad ? ` <span class="hint">/${esc(p.unidad)}</span>` : ''}${p.tipo === 'reventa' ? ' <span class="chip neutral">reventa</span>' : ''} ${problemasTxt(c)}</td>
      <td class="amt num">${fmt(c.costoUnit)}</td><td class="amt num">${fmt(p.precio)}</td>
      <td class="amt num ${m && m.margen < 0.3 ? 'bad' : ''}">${m ? pct(m.margen) : '—'}</td>
      <td class="amt num hide-sm">${fmt(Calc.precioSugerido(c.costoUnit, p.recargo))}</td></tr>`;
  });
  $('tbl-mp').innerHTML = html || '<tr><td colspan="5" class="empty">No hay productos.</td></tr>';
  if ($('mp-panel').style.display !== 'none') renderMpCalc();
}
function abrirProducto(id) {
  mpEditId = id;
  const p = id ? C.idx.productos.get(id) : null;
  $('mp-titulo').textContent = p ? p.nombre : 'Nuevo producto';
  $('mp-nombre').value = p ? p.nombre : '';
  $('mp-familia').value = p ? p.categoria || '' : '';
  $('mp-tipo').value = p ? p.tipo : 'propio';
  $('mp-precio').value = p && p.precio !== null ? p.precio : '';
  $('mp-may').value = p && p.precioMayorista !== null ? p.precioMayorista : '';
  $('mp-recargo').value = p && p.recargo !== null ? Math.round(p.recargo * 100) : 100;
  $('mp-min').value = p && p.stockMinimo !== null ? p.stockMinimo : '';
  $('mp-notas').value = p ? p.notas || '' : '';
  $('mp-activo').checked = p ? p.activo : true;
  $('mp-borrar').style.display = p ? '' : 'none';
  $('mp-receta').style.display = p ? '' : 'none';
  $('mp-panel').style.display = '';
  $('mp-panel').classList.add('editing');
  renderMpCalc();
  $('mp-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function sugeridoForm() {
  const cu = mpEditId ? costoU(mpEditId) : null;
  const rec = numVal('mp-recargo');
  return Calc.precioSugerido(cu, rec === null ? 1 : rec / 100);
}
function renderMpCalc() {
  const cu = mpEditId ? costoU(mpEditId) : null;
  const precio = numVal('mp-precio');
  const m = Calc.margen(precio, cu);
  const box = (l, v, cls) => `<div><div class="l">${l}</div><div class="v num ${cls || ''}">${v}</div></div>`;
  const p = mpEditId ? C.idx.productos.get(mpEditId) : null;
  $('mp-calc').innerHTML =
    box(`Costo por ${esc((p && p.unidad) || 'unidad')} (receta)`, cu === null ? '<span class="warn" style="font-size:13px">sin receta</span>' : fmt(cu)) +
    box(`Sugerido (costo + ${fmtQ(numVal('mp-recargo') ?? 100)}%)`, fmt(sugeridoForm())) +
    box('Ganancia por unidad', m ? fmt(m.ganancia) : '—', m && m.ganancia < 0 ? 'bad' : '') +
    box('Margen', m ? pct(m.margen) : '—', m && m.margen < 0.3 ? 'bad' : '');
  $('mp-usar-sug').disabled = sugeridoForm() === null;
}
async function guardarMProducto() {
  const rec = numVal('mp-recargo');
  const body = {
    nombre: $('mp-nombre').value, categoria: $('mp-familia').value || null, tipo: $('mp-tipo').value,
    precio: numVal('mp-precio'), precioMayorista: numVal('mp-may'), recargo: rec === null ? null : rec / 100,
    stockMinimo: numVal('mp-min'), notas: $('mp-notas').value, activo: $('mp-activo').checked
  };
  const r = mpEditId ? await api('PUT', '/api/productos/' + mpEditId, body) : await api('POST', '/api/productos', body);
  toast('Producto guardado.');
  if (!mpEditId && r.id) {
    // producto nuevo: seguir con la receta
    $('mp-panel').style.display = 'none';
    mpEditId = null;
    cargarReceta(r.id);
    showTab('recetario');
    toast('Producto creado. Ahora cargá su receta y la unidad de venta.');
  }
}

function renderMInsumos() {
  const q = $('mi-buscar').value.trim().toLowerCase(), fam = $('mi-filtro-fam').value;
  const usos = new Map();
  S.recetas.forEach(l => usos.set(l.insumoId, (usos.get(l.insumoId) || 0) + 1));
  const fams = familias('insumo');
  const list = S.insumos.filter(i => (!q || i.nombre.toLowerCase().includes(q)) && (!fam || i.familia === fam))
    .sort((a, b) => (a.familia || 'zzz').localeCompare(b.familia || 'zzz') || a.nombre.localeCompare(b.nombre));
  let g0 = null, html = '';
  list.forEach(i => {
    const g = i.familia || 'Sin familia';
    if (g !== g0) { g0 = g; html += `<tr class="cat"><td colspan="7">${esc(g)}</td></tr>`; }
    html += `<tr>
      <td>${esc(i.nombre)}${i.costo === null ? ' <span class="chip pend">sin precio</span>' : ''}</td>
      <td><select class="inline" data-famins="${i.id}" aria-label="Familia de ${esc(i.nombre)}"><option value="">—</option>${fams.map(f => `<option${f === i.familia ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></td>
      <td class="hide-sm">${esc(i.unidad || '')}</td>
      <td class="amt"><input type="number" class="inline" data-costo="${i.id}" value="${i.costo ?? ''}" min="0" step="0.01" inputmode="decimal" aria-label="Precio de ${esc(i.nombre)}"></td>
      <td class="hide-sm num">${fDate(i.actualizado || '')}</td>
      <td class="hide-sm">${usos.get(i.id) ? usos.get(i.id) + ' producto' + (usos.get(i.id) === 1 ? '' : 's') : '<span class="muted">—</span>'}</td>
      <td class="amt">${usos.get(i.id) ? '' : `<button class="btn ghost small" data-borrari="${i.id}">Borrar</button>`}</td></tr>`;
  });
  $('tbl-mi').innerHTML = html || '<tr><td colspan="7" class="empty">No hay insumos.</td></tr>';
}
async function guardarPrecioInsumo(inp) {
  const ins = S.insumos.find(i => i.id === inp.dataset.costo);
  if (!ins) return;
  const v = inp.value.trim() === '' ? null : Number(inp.value.replace(',', '.'));
  if (v === ins.costo || (v !== null && isNaN(v))) return;
  const antes = Calc.costosTodos(S);
  await api('PUT', '/api/insumos/' + ins.id, { costo: v });
  const afectados = Calc.productosQueUsan(S, ins.id);
  const ej = afectados.slice(0, 2).map(p => { const a = antes.get(p.id).costoUnit, d = C.costos.get(p.id).costoUnit; return a !== null && d !== null ? `${p.nombre} ${fmt(a)} → ${fmt(d)}` : p.nombre; });
  toast(`${ins.nombre}: ${fmt(v)}.` + (afectados.length ? ` Recalculados ${afectados.length} productos (${ej.join('; ')}${afectados.length > 2 ? '…' : ''}).` : ''));
}

let clienteEditId = null;
function resetClienteForm() {
  clienteEditId = null;
  ['c-nombre', 'c-tel', 'c-notas'].forEach(id => { $(id).value = ''; });
  $('c-tipo').value = 'Particular';
  $('c-titulo').textContent = 'Nuevo cliente';
  $('c-cancelar').style.display = 'none';
  $('cliente-panel').classList.remove('editing');
}
function editarCliente(id) {
  const c = S.clientes.find(x => x.id === id);
  if (!c) return;
  clienteEditId = id;
  $('c-nombre').value = c.nombre;
  $('c-tipo').value = c.tipo;
  $('c-tel').value = c.telefono || '';
  $('c-notas').value = c.notas || '';
  $('c-titulo').textContent = 'Editando ' + c.nombre;
  $('c-cancelar').style.display = '';
  $('cliente-panel').classList.add('editing');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function guardarCliente() {
  const body = { nombre: $('c-nombre').value, tipo: $('c-tipo').value, telefono: $('c-tel').value, notas: $('c-notas').value };
  if (clienteEditId) await api('PUT', '/api/clientes/' + clienteEditId, body);
  else await api('POST', '/api/clientes', body);
  toast('Cliente guardado.');
  resetClienteForm();
}
function renderMClientes() {
  const q = $('c-buscar').value.trim().toLowerCase();
  const stats = new Map(Calc.porCliente(S).map(x => [x.clienteId, x]));
  const list = S.clientes.filter(c => !q || c.nombre.toLowerCase().includes(q))
    .map(c => ({ c, s: stats.get(c.id) || { cantVentas: 0, total: 0, pendiente: 0, ultima: '' } }))
    .sort((a, b) => b.s.total - a.s.total || a.c.nombre.localeCompare(b.c.nombre));
  $('tbl-clientes').innerHTML = list.map(({ c, s }) => `<tr>
      <td>${esc(c.nombre)}${c.tipo === 'Mayorista' ? ' <span class="chip neutral">mayorista</span>' : ''}${c.telefono ? `<div class="hint">${esc(c.telefono)}</div>` : ''}${c.notas ? `<div class="hint">${esc(c.notas)}</div>` : ''}</td>
      <td class="amt num">${s.cantVentas}</td><td class="amt num">${fmt(s.total)}</td><td class="hide-sm num">${fDate(s.ultima)}</td>
      <td class="amt num ${s.pendiente > 0 ? 'warn' : ''}">${s.pendiente > 0 ? fmt(s.pendiente) : '—'}</td>
      <td class="amt"><button class="btn ghost small" data-editc="${c.id}">Editar</button>${s.cantVentas ? '' : `<button class="btn ghost small" data-borrarc="${c.id}">Borrar</button>`}</td></tr>`).join('')
    || '<tr><td colspan="6" class="empty">No hay clientes.</td></tr>';
}

function renderMFamilias() {
  let html = '';
  [['producto', 'Familias de productos'], ['insumo', 'Familias de insumos']].forEach(([tipo, titulo]) => {
    html += `<tr class="cat"><td colspan="3">${titulo}</td></tr>`;
    familias(tipo).forEach(f => {
      const n = tipo === 'producto' ? S.productos.filter(p => p.categoria === f).length : S.insumos.filter(i => i.familia === f).length;
      html += `<tr><td>${esc(f)}</td><td class="amt num">${n} ${tipo === 'producto' ? 'productos' : 'insumos'}</td>
        <td class="amt"><button class="btn ghost small" data-renfam="${esc(tipo)}|${esc(f)}">Renombrar</button>${n ? '' : `<button class="btn ghost small" data-borrarfam="${esc(tipo)}|${esc(f)}">Borrar</button>`}</td></tr>`;
    });
  });
  $('tbl-fa').innerHTML = html;
}

/* ================= CONFIGURACIÓN ================= */

RENDER.config = function () {
  const usos = new Map();
  S.gastos.forEach(g => usos.set(g.categoria, (usos.get(g.categoria) || 0) + 1));
  $('tbl-cats').innerHTML = S.categoriasGasto.map(c => `<tr><td>${esc(c.nombre)} <span class="hint">${usos.get(c.nombre) || 0} egresos</span></td>
    <td><select data-grupo="${esc(c.nombre)}" style="width:auto;">${['Mercadería', 'Fijos', 'Otros'].map(g => `<option${g === c.grupo ? ' selected' : ''}>${g}</option>`).join('')}</select></td>
    <td class="amt"><button class="btn ghost small" data-renombrar="${esc(c.nombre)}">Renombrar</button>${usos.get(c.nombre) ? '' : `<button class="btn ghost small" data-borrarcat="${esc(c.nombre)}">Borrar</button>`}</td></tr>`).join('');
};
async function previewImport() {
  const r = await api('GET', '/api/importar');
  mostrarImport(r, false);
  $('imp-run').disabled = !r.baseVacia;
}
function mostrarImport(r, hecho) {
  const x = r.resumen;
  const grupos = new Map();
  r.avisos.forEach(a => { if (!grupos.has(a.seccion)) grupos.set(a.seccion, []); grupos.get(a.seccion).push(a.texto); });
  $('imp-result').innerHTML = `<div class="alert"><b>${hecho ? 'Importado' : 'Se importaría'}:</b> ${x.productos} productos, ${x.insumos} insumos, ${x.recetas} renglones de receta,
    ${x.producciones} producciones, ${x.ventas} ventas (${fmt(x.totalVentas)}), ${x.gastos} egresos (${fmt(x.totalGastos)}), ${x.clientes} clientes, ${x.ajustes} ajustes de stock.</div>
    ${!hecho && r.baseVacia === false ? '<div class="alert bad">La app ya tiene datos: la importación solo se hace con la base vacía.</div>' : ''}
    <h3 class="sub">Lo que encontré en la planilla (${r.avisos.length})</h3>
    ${[...grupos].map(([s, ts]) => `<details${ts.length < 6 ? ' open' : ''}><summary><b>${esc(s)}</b> (${ts.length})</summary><ul>${ts.map(t => `<li class="hint">${esc(t)}</li>`).join('')}</ul></details>`).join('')}`;
}
async function runImport() {
  if (!confirm('¿Importar los datos de la planilla vieja a la app? Las pestañas viejas no se tocan.')) return;
  const r = await api('POST', '/api/importar');
  mostrarImport(r, true);
  $('imp-run').disabled = true;
  toast('Importación terminada.');
}

/* ================= eventos ================= */

const del = async (msg, url) => { if (confirm(msg)) await api('DELETE', url).catch(() => {}); };

document.addEventListener('click', async e => {
  const t = e.target.closest('button, tr[data-editp], tr[data-receta], tr[data-pvg]');
  if (!t) return;
  const d = t.dataset;
  const segDe = id => t.parentElement && t.parentElement.id === id;
  if (d.tab) return showTab(d.tab);
  if (d.goto) { if (d.dm) dmVista = d.dm; return showTab(d.goto); }
  if (d.mes) { inicioMes = moverMes(inicioMes, Number(d.mes)); return render(); }
  if (d.vmes) { ventasMes = moverMes(ventasMes, Number(d.vmes)); $('ventas-pend').checked = false; return render(); }
  if (d.omes) { oiMes = moverMes(oiMes, Number(d.omes)); return render(); }
  if (d.gmes) { gastosMes = moverMes(gastosMes, Number(d.gmes)); return render(); }
  if (d.pmes) { prodMes = moverMes(prodMes, Number(d.pmes)); return render(); }
  if (segDe('ing-seg')) { ingVista = d.v; return render(); }
  if (segDe('pn-seg')) { pnVista = d.v; return render(); }
  if (segDe('pc-chips')) { pcVista = d.v; return render(); }
  if (segDe('dm-seg')) { dmVista = d.v; return render(); }
  if (segDe('v-estado')) { ventaEstado = d.v; return renderVentaForm(); }
  // ventas
  if (d.quitar !== undefined) { ventaItems.splice(Number(d.quitar), 1); if (!ventaItems.length) ventaItems.push(nuevoRenglon()); return renderVentaForm(); }
  if (d.editv) return editarVenta(d.editv);
  if (d.borrarv) {
    const v = S.ventas.find(x => x.id === d.borrarv);
    if (v) { await del(`¿Borrar la venta del ${fDate(v.fecha)}${v.clienteId ? ' a ' + cliNombre(v.clienteId) : ''} por ${fmt(v.total)}?`, '/api/ventas/' + v.id); if (ventaEditId === v.id && !S.ventas.some(x => x.id === v.id)) resetVentaForm(); }
    return;
  }
  if (d.cobro) {
    const v = S.ventas.find(x => x.id === d.cobro);
    if (v) await api('PATCH', `/api/ventas/${v.id}/cobro`, { estadoPago: v.estadoPago === 'pagado' ? 'pendiente' : 'pagado' }).catch(() => {});
    return;
  }
  // otros ingresos
  if (d.editoi) {
    const o = S.otrosIngresos.find(x => x.id === d.editoi);
    if (!o) return;
    oiEditId = o.id;
    $('oi-fecha').value = o.fecha; $('oi-concepto').value = o.concepto; $('oi-monto').value = o.monto; $('oi-medio').value = o.medioPago || ''; $('oi-nota').value = o.nota || '';
    $('oi-titulo').textContent = 'Editando ingreso del ' + fDate(o.fecha);
    $('oi-cancelar').style.display = '';
    $('oi-panel').classList.add('editing');
    return window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (d.borraroi) { const o = S.otrosIngresos.find(x => x.id === d.borraroi); if (o) await del(`¿Borrar "${o.concepto}" por ${fmt(o.monto)}?`, '/api/otros-ingresos/' + o.id); return; }
  // egresos
  if (d.editg) return editarGasto(d.editg);
  if (d.borrarg) { const g = S.gastos.find(x => x.id === d.borrarg); if (g) await del(`¿Borrar el egreso de ${g.categoria} del ${fDate(g.fecha)} por ${fmt(g.monto)}?`, '/api/gastos/' + g.id); return; }
  // producción / stock
  if (d.borrarp) { const p = S.producciones.find(x => x.id === d.borrarp); if (p) await del(`¿Borrar la producción de ${fmtQ(p.cantidad)} ${prodNombre(p.productoId)} del ${fDate(p.fecha)}?`, '/api/producciones/' + p.id); return; }
  if (d.ajustar) { $('a-prod').value = d.ajustar; $('a-cant').focus(); $('ajuste-panel').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.borrara) return del('¿Borrar este ajuste de stock?', '/api/ajustes/' + d.borrara);
  // panel
  if (t.id === 'pv-mas') { pvLimite += 40; return render(); }
  if (d.pvg !== undefined) { pvAbiertos.has(d.pvg) ? pvAbiertos.delete(d.pvg) : pvAbiertos.add(d.pvg); return render(); }
  // recetario
  if (d.receta) { cargarReceta(d.receta); return $('rec-panel').scrollIntoView({ behavior: 'smooth' }); }
  if (d.quitarr !== undefined) { receta.lineas.splice(Number(d.quitarr), 1); return renderRecetaLineas(); }
  // maestros
  if (d.editp) return abrirProducto(d.editp);
  if (d.borrari) { const i = S.insumos.find(x => x.id === d.borrari); if (i) await del(`¿Borrar el insumo ${i.nombre}?`, '/api/insumos/' + i.id); return; }
  if (d.editc) return editarCliente(d.editc);
  if (d.borrarc) { const c = S.clientes.find(x => x.id === d.borrarc); if (c) await del(`¿Borrar a ${c.nombre}?`, '/api/clientes/' + c.id); return; }
  if (d.renfam) {
    const [tipo, nombre] = d.renfam.split('|');
    const nuevo = prompt('Nuevo nombre de la familia (se actualiza en todo lo que la usa):', nombre);
    if (nuevo && nuevo.trim() && nuevo.trim() !== nombre) await api('PUT', `/api/familias/${tipo}/${encodeURIComponent(nombre)}`, { nuevoNombre: nuevo.trim() }).catch(() => {});
    return;
  }
  if (d.borrarfam) { const [tipo, nombre] = d.borrarfam.split('|'); return del(`¿Borrar la familia ${nombre}?`, `/api/familias/${tipo}/${encodeURIComponent(nombre)}`); }
  // config
  if (d.renombrar) {
    const nuevo = prompt('Nuevo nombre para la categoría (se actualizan los egresos que la usan):', d.renombrar);
    if (nuevo && nuevo.trim() && nuevo.trim() !== d.renombrar) await api('PUT', '/api/categorias-gasto/' + encodeURIComponent(d.renombrar), { nuevoNombre: nuevo.trim() }).catch(() => {});
    return;
  }
  if (d.borrarcat) return del(`¿Borrar la categoría ${d.borrarcat}?`, '/api/categorias-gasto/' + encodeURIComponent(d.borrarcat));
});

// Venta: cambios en renglones.
$('v-items').addEventListener('input', e => {
  const row = e.target.closest('.item');
  if (!row) return;
  const it = ventaItems[Number(row.dataset.i)];
  const f = e.target.dataset.f;
  if (f === 'productoId') {
    it.productoId = e.target.value;
    it.precioUnit = precioPara(C.idx.productos.get(it.productoId));
    it.precioTocado = false;
    if (Number(row.dataset.i) === ventaItems.length - 1 && it.productoId) ventaItems.push(nuevoRenglon());
    return renderVentaForm();
  }
  it[f] = e.target.value.trim() === '' ? null : Number(e.target.value.replace(',', '.'));
  if (f === 'precioUnit') it.precioTocado = true;
  // total y subtotal sin redibujar (para no perder el foco)
  $('v-total').textContent = fmt(Calc.sum(ventaItems, x => (x.cantidad || 0) * (x.precioUnit || 0)));
  const sub = row.querySelector('.sub');
  if (sub) sub.innerHTML = sub.innerHTML.replace(/Subtotal [^<]*$/, 'Subtotal ' + fmt((it.cantidad || 0) * (it.precioUnit || 0)));
});
$('v-items').addEventListener('change', e => { if (e.target.dataset.f === 'cantidad') renderVentaForm(); });
$('v-cliente').addEventListener('input', () => {
  ventaItems.forEach(it => { if (!it.precioTocado && it.productoId) it.precioUnit = precioPara(C.idx.productos.get(it.productoId)); });
  renderVentaForm();
});
$('v-cliente-tipo').addEventListener('change', () => $('v-cliente').dispatchEvent(new Event('input')));
$('v-add').addEventListener('click', () => { ventaItems.push(nuevoRenglon()); renderVentaForm(); });
$('v-guardar').addEventListener('click', e => guardando(e.target, guardarVenta));
$('v-cancelar').addEventListener('click', resetVentaForm);
$('ventas-mes').addEventListener('change', e => { if (e.target.value) { ventasMes = e.target.value; $('ventas-pend').checked = false; render(); } });
$('ventas-pend').addEventListener('change', render);
$('inicio-mes').addEventListener('change', e => { if (e.target.value) { inicioMes = e.target.value; render(); } });
$('oi-guardar').addEventListener('click', e => guardando(e.target, guardarOi));
$('oi-cancelar').addEventListener('click', resetOiForm);
$('oi-mes').addEventListener('change', e => { if (e.target.value) { oiMes = e.target.value; render(); } });

$('g-guardar').addEventListener('click', e => guardando(e.target, guardarGasto));
$('g-cancelar').addEventListener('click', resetGastoForm);
$('gastos-mes').addEventListener('change', e => { if (e.target.value) { gastosMes = e.target.value; render(); } });

$('p-prod').addEventListener('change', renderProdInfo);
$('p-cant').addEventListener('input', renderProdInfo);
$('p-guardar').addEventListener('click', e => guardando(e.target, guardarProduccion));
$('prod-mes').addEventListener('change', e => { if (e.target.value) { prodMes = e.target.value; render(); } });

$('s-todos').addEventListener('change', render);
$('s-conteo-btn').addEventListener('click', () => { modoConteo = true; render(); });
$('s-conteo-cancelar').addEventListener('click', () => { modoConteo = false; render(); });
$('s-conteo-guardar').addEventListener('click', e => guardando(e.target, guardarConteo));
$('a-guardar').addEventListener('click', e => guardando(e.target, guardarAjuste));

// Panel
$('pn-periodo').addEventListener('change', render);
['pn-desde', 'pn-hasta'].forEach(id => $(id).addEventListener('change', () => { $('pn-periodo').value = 'custom'; render(); }));
$('pn-comp').addEventListener('change', render);
$('pv-group').addEventListener('change', () => { pvAbiertos.clear(); pvLimite = 40; render(); });
$('pv-buscar').addEventListener('input', () => { pvLimite = 40; render(); });
$('pv-export').addEventListener('click', exportarPanelVentas);
$('pc-export').addEventListener('click', exportarPanelCostos);
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (tabActual === 'panel' && pnVista === 'resultados') render(); }, 200); });

// Recetario
$('rc-prod').addEventListener('change', e => cargarReceta(e.target.value || null));
$('rc-receta').addEventListener('input', e => {
  const row = e.target.closest('.item');
  if (!row) return;
  const l = receta.lineas[Number(row.dataset.i)];
  if (e.target.dataset.f === 'insumoId') { l.insumoId = e.target.value; return renderRecetaLineas(); }
  l.cantidad = e.target.value.trim() === '' ? null : Number(e.target.value.replace(',', '.'));
  renderRecetaCalc();
});
['rc-rinde', 'rc-unidad'].forEach(id => $(id).addEventListener('input', renderRecetaCalc));
$('rc-add').addEventListener('click', () => { receta.lineas.push({ insumoId: '', cantidad: null }); renderRecetaLineas(); });
$('rc-copiar').addEventListener('change', e => {
  const de = e.target.value;
  if (!de) return;
  if (receta.lineas.some(l => l.insumoId) && !confirm(`¿Reemplazar la receta actual por la de ${prodNombre(de)}? (No se guarda hasta que toques Guardar.)`)) { e.target.value = ''; return; }
  receta.lineas = S.recetas.filter(l => l.productoId === de).map(l => ({ insumoId: l.insumoId, cantidad: l.cantidad }));
  const o = C.idx.productos.get(de);
  if (!$('rc-rinde').value && o.rinde) $('rc-rinde').value = o.rinde;
  if (!$('rc-unidad').value && o.unidad) $('rc-unidad').value = o.unidad;
  renderRecetaLineas();
});
$('rc-guardar').addEventListener('click', e => guardando(e.target, guardarReceta));
$('rc-precio').addEventListener('click', () => { const id = receta.productoId; dmVista = 'productos'; showTab('maestros'); abrirProducto(id); });

// Datos maestros
$('mp-nuevo').addEventListener('click', () => abrirProducto(null));
$('mp-buscar').addEventListener('input', renderMProductos);
$('mp-filtro-fam').addEventListener('change', renderMProductos);
['mp-precio', 'mp-recargo'].forEach(id => $(id).addEventListener('input', renderMpCalc));
$('mp-usar-sug').addEventListener('click', () => { const s = sugeridoForm(); if (s !== null) { $('mp-precio').value = Math.round(s); renderMpCalc(); } });
$('mp-guardar').addEventListener('click', e => guardando(e.target, guardarMProducto));
$('mp-cerrar').addEventListener('click', () => { $('mp-panel').style.display = 'none'; mpEditId = null; });
$('mp-receta').addEventListener('click', () => { cargarReceta(mpEditId); showTab('recetario'); });
$('mp-borrar').addEventListener('click', e => guardando(e.target, async () => {
  if (!confirm('¿Borrar este producto y su receta?')) return;
  await api('DELETE', '/api/productos/' + mpEditId);
  $('mp-panel').style.display = 'none';
  mpEditId = null;
  toast('Producto borrado.');
}));
$('mi-buscar').addEventListener('input', renderMInsumos);
$('mi-filtro-fam').addEventListener('change', renderMInsumos);
$('tbl-mi').addEventListener('change', e => {
  if (e.target.dataset.costo) guardarPrecioInsumo(e.target).catch(() => {});
  if (e.target.dataset.famins !== undefined) api('PUT', '/api/insumos/' + e.target.dataset.famins, { familia: e.target.value || null }).then(() => toast('Familia actualizada.')).catch(() => {});
});
$('tbl-mi').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.costo) e.target.blur(); });
$('mi-guardar').addEventListener('click', e => guardando(e.target, async () => {
  await api('POST', '/api/insumos', { nombre: $('mi-nombre').value, familia: $('mi-familia').value || null, unidad: $('mi-unidad').value, costo: numVal('mi-costo') });
  toast('Insumo agregado.');
  ['mi-nombre', 'mi-unidad', 'mi-costo'].forEach(id => { $(id).value = ''; });
}));
$('c-guardar').addEventListener('click', e => guardando(e.target, guardarCliente));
$('c-cancelar').addEventListener('click', resetClienteForm);
$('c-buscar').addEventListener('input', renderMClientes);
$('fa-guardar').addEventListener('click', e => guardando(e.target, async () => {
  await api('POST', '/api/familias', { nombre: $('fa-nombre').value, tipo: $('fa-tipo').value });
  $('fa-nombre').value = '';
  toast('Familia agregada.');
}));

// Configuración
$('tbl-cats').addEventListener('change', e => {
  if (e.target.dataset.grupo) api('PUT', '/api/categorias-gasto/' + encodeURIComponent(e.target.dataset.grupo), { grupo: e.target.value }).catch(() => {});
});
$('cat-guardar').addEventListener('click', e => guardando(e.target, async () => {
  await api('POST', '/api/categorias-gasto', { nombre: $('cat-nombre').value, grupo: $('cat-grupo').value });
  $('cat-nombre').value = '';
  toast('Categoría agregada.');
}));
$('imp-preview').addEventListener('click', e => guardando(e.target, previewImport));
$('imp-run').addEventListener('click', e => guardando(e.target, runImport));

$('login-btn').addEventListener('click', login);
$('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
$('logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); S = null; showLogin(); });

[$('v-medio'), $('g-medio'), $('oi-medio')].forEach(sel => fillSelect(sel, MEDIOS, '—'));

try { tabActual = localStorage.getItem('kasa-tab') || 'inicio'; } catch { /* sin storage */ }
if (!RENDER[tabActual]) tabActual = 'inicio';
document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabActual));
document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tabActual));
start();
