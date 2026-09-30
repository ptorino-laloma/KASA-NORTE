// Frontend de Kasa Norte. Sin frameworks ni build: HTML en index.html, cálculos
// del negocio en calc.js (window.Calc, compartido con el servidor) y acá la UI.
//
// Patrón: GET /api/state trae todo; cada mutación devuelve el state completo
// actualizado y se vuelve a dibujar la pestaña activa. El servidor valida todo.
'use strict';

/* ================= utilidades ================= */

const $ = id => document.getElementById(id);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
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
function hoy() { return (S && S.config && S.config.hoy) || new Date().toISOString().slice(0, 10); }
function mesActual() { return hoy().slice(0, 7); }
function moverMes(ym, delta) {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
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
  const idx = Calc.indices(S);
  C = { idx, costos: Calc.costosTodos(S), stock: Calc.stock(S) };
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
  if (!res.ok) { document.body.classList.add('logged-in'); toast(data.error || 'Error cargando los datos.', true); return; }
  document.body.classList.add('logged-in');
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

// Listas compartidas (selects de productos, datalists) que dependen del state.
function productosActivos() {
  return S.productos.filter(p => p.activo).sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || a.nombre.localeCompare(b.nombre));
}
function opcionesProductos(incluirInactivos) {
  const list = incluirInactivos ? [...S.productos].sort((a, b) => a.nombre.localeCompare(b.nombre)) : productosActivos();
  const grupos = new Map();
  list.forEach(p => {
    const g = p.categoria || 'Sin categoría';
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push({ value: p.id, label: p.nombre + (p.unidad ? ` (${p.unidad})` : '') });
  });
  return [...grupos].map(([group, options]) => ({ group, options }));
}
function refreshListas() {
  $('dl-clientes').innerHTML = [...S.clientes].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(c => `<option value="${esc(c.nombre)}">`).join('');
  const provs = [...new Set(S.gastos.map(g => g.proveedor).filter(Boolean))].sort();
  $('dl-proveedores').innerHTML = provs.map(p => `<option value="${esc(p)}">`).join('');
  const cats = [...new Set(S.productos.map(p => p.categoria).filter(Boolean))].sort();
  $('dl-cats-prod').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  const opts = opcionesProductos(false);
  fillSelect($('p-prod'), opts, 'Elegí un producto');
  fillSelect($('a-prod'), opcionesProductos(true), 'Elegí un producto');
  fillSelect($('g-cat'), S.categoriasGasto.map(c => c.nombre), 'Elegí la categoría');
  fillSelect($('cp-cat'), cats, 'Todas');
  fillSelect($('cat-grupo'), ['Mercadería', 'Fijos', 'Otros']);
}
const prodNombre = id => (C.idx.productos.get(id) || {}).nombre || '(borrado)';
const cliNombre = id => id ? ((C.idx.clientes.get(id) || {}).nombre || '(borrado)') : '';
const costoU = id => { const c = C.costos.get(id); return c ? c.costoUnit : null; };

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
    kpi('Resultado', fmt(r.resultado), 'ventas − egresos', r.resultado < 0 ? 'bad' : 'good') +
    kpi('Margen teórico', pct(r.margenTeorico), r.ingresoConCosto ? `${fmt(r.gananciaTeorica)} sobre ${fmt(r.ingresoConCosto)}` : 'sin ventas con productos') +
    kpi('Por cobrar', fmt(pendTotal), 'todas las fechas', pendTotal > 0 ? 'warn' : '');

  const alertas = [];
  const negativos = S.productos.filter(p => (C.stock.get(p.id) || {}).stock < 0);
  if (negativos.length) alertas.push(['bad', `${negativos.length} producto${negativos.length === 1 ? '' : 's'} con stock negativo (se vendió más de lo que figura producido). <button class="link" data-goto="stock">Ver stock</button>`]);
  const bajos = S.productos.filter(p => p.activo && p.stockMinimo !== null && (C.stock.get(p.id) || {}).stock >= 0 && (C.stock.get(p.id) || {}).stock < p.stockMinimo);
  if (bajos.length) alertas.push(['', `Stock bajo el mínimo: ${bajos.map(p => esc(p.nombre)).join(', ')}.`]);
  const sinCosto = S.productos.filter(p => p.activo && costoU(p.id) === null);
  if (sinCosto.length) alertas.push(['', `${sinCosto.length} producto${sinCosto.length === 1 ? '' : 's'} activo${sinCosto.length === 1 ? '' : 's'} sin costo (falta receta o rinde): ${sinCosto.slice(0, 6).map(p => esc(p.nombre)).join(', ')}${sinCosto.length > 6 ? '…' : ''}. <button class="link" data-goto="costos">Ir a Costos</button>`]);
  const sinPrecio = S.productos.filter(p => p.activo && !(p.precio > 0));
  if (sinPrecio.length) alertas.push(['', `Sin precio de venta: ${sinPrecio.slice(0, 6).map(p => esc(p.nombre)).join(', ')}${sinPrecio.length > 6 ? '…' : ''}.`]);
  const perdida = S.productos.filter(p => p.activo && p.precio > 0 && costoU(p.id) !== null && costoU(p.id) >= p.precio);
  if (perdida.length) alertas.push(['bad', `Se venden a pérdida (costo ≥ precio): ${perdida.map(p => esc(p.nombre)).join(', ')}.`]);
  if (r.ventasSinDetalle > 0) alertas.push(['', `${fmt(r.ventasSinDetalle)} de ventas del mes no tienen productos cargados: no descuentan stock ni entran en el margen.`]);
  const gPend = Calc.sum(S.gastos.filter(g => g.estadoPago === 'pendiente'), g => g.monto);
  if (gPend > 0) alertas.push(['', `Gastos a pagar: ${fmt(gPend)}.`]);
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

/* ================= VENTAS ================= */

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
    // Si se edita una venta con un producto ya desactivado, igual tiene que aparecer.
    const extra = p && !p.activo ? `<option value="${esc(p.id)}" selected>${esc(p.nombre)} (inactivo)</option>` : '';
    return `<div class="item" data-i="${i}">
      <select data-f="productoId" aria-label="Producto"><option value="">Producto…</option>${extra}${optsHtml}</select>
      <input type="number" data-f="cantidad" value="${it.cantidad ?? ''}" min="0" step="0.5" inputmode="decimal" aria-label="Cantidad">
      <input type="number" data-f="precioUnit" value="${it.precioUnit ?? ''}" min="0" step="1" inputmode="decimal" aria-label="Precio unitario" placeholder="Precio">
      <button class="x" data-quitar="${i}" aria-label="Quitar">×</button>${sub}</div>`;
  }).join('');
  const total = Calc.sum(ventaItems, it => (it.cantidad || 0) * (it.precioUnit || 0));
  $('v-total').textContent = fmt(total);
  document.querySelectorAll('#v-estado button').forEach(b => b.classList.toggle('on', b.dataset.v === ventaEstado));
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
  $('v-fecha').value = fecha; // se suele cargar varias del mismo día
  ventasMes = fecha.slice(0, 7);
  render();
}

function detalleVenta(v) {
  const items = C.idx.itemsPorVenta.get(v.id) || [];
  if (!items.length) return '<span class="muted">sin detalle</span>';
  return items.map(i => `${fmtQ(i.cantidad)} ${esc(prodNombre(i.productoId))}`).join(', ');
}

RENDER.vender = function () {
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
      <td class="amt"><button class="btn ghost small" data-editv="${v.id}">Editar</button><button class="btn ghost small" data-borrarv="${v.id}" aria-label="Borrar">Borrar</button></td>
    </tr>`).join('');
  $('ventas-empty').style.display = list.length ? 'none' : '';
  $('ventas-empty').textContent = soloPend ? 'No hay ventas pendientes de cobro.' : 'No hay ventas en este mes.';
};

/* ================= GASTOS ================= */

let gastoEditId = null;
let gastosMes = null;

function resetGastoForm() {
  gastoEditId = null;
  $('g-fecha').value = hoy();
  $('g-monto').value = '';
  $('g-nota').value = '';
  $('g-prov').value = '';
  $('g-estado').value = 'pagado';
  $('g-medio').value = 'Transferencia';
  $('gasto-titulo').textContent = 'Nuevo gasto';
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
  $('gasto-titulo').textContent = 'Editando gasto del ' + fDate(g.fecha);
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
  toast(gastoEditId ? 'Gasto actualizado.' : 'Gasto guardado.');
  const { fecha, categoria } = body;
  resetGastoForm();
  $('g-fecha').value = fecha;
  $('g-cat').value = categoria;
  gastosMes = fecha.slice(0, 7);
  render();
}
RENDER.gastos = function () {
  gastosMes = gastosMes || mesActual();
  $('gastos-mes').value = gastosMes;
  if (!$('g-fecha').value) resetGastoForm();
  const list = S.gastos.filter(g => g.fecha.startsWith(gastosMes)).sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || '').localeCompare(a.creado || ''));
  const r = Calc.resumen(S, Calc.rangoMes(gastosMes));
  const cats = Object.entries(r.porCategoria).sort((a, b) => b[1] - a[1]);
  $('gastos-cats').innerHTML = list.length
    ? `<div class="kpis">${cats.map(([c, m]) => `<div class="kpi"><div class="label">${esc(c)}</div><div class="value num" style="font-size:16px">${fmt(m)}</div></div>`).join('')}
       <div class="kpi"><div class="label">Total</div><div class="value num" style="font-size:16px">${fmt(r.gastosTotal)}</div></div></div>` : '';
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
  if (!p) { $('p-info').textContent = ''; $('p-cant-label').textContent = 'Cantidad'; return; }
  $('p-cant-label').textContent = `Cantidad${p.unidad ? ' (' + p.unidad + ')' : ''}`;
  const c = C.costos.get(p.id);
  const partes = [];
  if (p.tipo === 'reventa') partes.push('Producto de reventa: cargá lo que compraste.');
  else if (p.rinde) partes.push(`Una tanda de la receta rinde ${fmtQ(p.rinde)}${p.unidad ? ' ' + esc(p.unidad) : ''}.`);
  partes.push(c && c.costoUnit !== null ? `Costo actual: ${fmt(c.costoUnit)} por ${esc(p.unidad || 'unidad')}.` : `<span class="warn">Sin costo calculado (${esc((c && c.problemas.join(', ')) || '')}).</span>`);
  const st = (C.stock.get(p.id) || {}).stock;
  partes.push(`Stock actual: ${fmtQ(st)}.`);
  $('p-info').innerHTML = partes.join(' ');
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
  $('tbl-prod').innerHTML = list.map(p => `<tr>
      <td class="num">${fDate(p.fecha)}</td><td>${esc(prodNombre(p.productoId))}${p.nota ? `<div class="hint">${esc(p.nota)}</div>` : ''}</td>
      <td class="amt num">${fmtQ(p.cantidad)}</td><td class="amt num">${fmt(p.costoUnit)}</td>
      <td class="amt num">${p.costoUnit === null ? '—' : fmt(p.costoUnit * p.cantidad)}</td>
      <td class="amt"><button class="btn ghost small" data-borrarp="${p.id}">Borrar</button></td></tr>`).join('') +
    (list.length ? `<tr class="total"><td colspan="4">Total al costo</td><td class="amt num">${fmt(Calc.sum(list.filter(p => p.costoUnit !== null), p => p.costoUnit * p.cantidad))}</td><td></td></tr>` : '');
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
    if ((p.categoria || 'Sin categoría') !== cat) { cat = p.categoria || 'Sin categoría'; html += `<tr class="cat"><td colspan="7">${esc(cat)}</td></tr>`; }
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

/* ================= COSTOS ================= */

let costosVista = 'productos';
let editorProd = null;   // { id|null, receta: [{insumoId, cantidad}] }

function problemasTxt(c) {
  if (!c) return '';
  if (c.problemas.length) return `<span class="chip pend">${esc(c.problemas.join(', '))}</span>`;
  if (c.avisos.length) return `<span class="chip warn" title="${esc(c.avisos.join(', '))}">incompleto</span>`;
  return '';
}
RENDER.costos = function () {
  document.querySelectorAll('#costos-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === costosVista));
  $('costos-productos').style.display = costosVista === 'productos' ? '' : 'none';
  $('costos-insumos').style.display = costosVista === 'insumos' ? '' : 'none';
  if (costosVista === 'productos') renderCostosProductos(); else renderInsumos();
  if (editorProd) renderEditorCalc();
};
function renderCostosProductos() {
  const q = $('cp-buscar').value.trim().toLowerCase(), cat = $('cp-cat').value;
  const list = [...S.productos].filter(p => (!q || p.nombre.toLowerCase().includes(q)) && (!cat || p.categoria === cat))
    .sort((a, b) => (a.activo === b.activo ? 0 : a.activo ? -1 : 1) || (a.categoria || 'zz').localeCompare(b.categoria || 'zz') || a.nombre.localeCompare(b.nombre));
  let c0 = null, html = '';
  list.forEach(p => {
    const c = C.costos.get(p.id);
    const grupo = p.activo ? (p.categoria || 'Sin categoría') : 'Inactivos';
    if (grupo !== c0) { c0 = grupo; html += `<tr class="cat"><td colspan="5">${esc(grupo)}</td></tr>`; }
    const m = Calc.margen(p.precio, c.costoUnit);
    const sug = Calc.precioSugerido(c.costoUnit, p.recargo);
    html += `<tr class="click" data-editp="${p.id}">
      <td>${esc(p.nombre)}${p.unidad ? ` <span class="hint">/${esc(p.unidad)}</span>` : ''}${p.tipo === 'reventa' ? ' <span class="chip neutral">reventa</span>' : ''} ${problemasTxt(c)}</td>
      <td class="amt num">${fmt(c.costoUnit)}</td><td class="amt num">${fmt(p.precio)}</td>
      <td class="amt num ${m && m.margen < 0.3 ? 'bad' : ''}">${m ? pct(m.margen) : '—'}</td>
      <td class="amt num hide-sm">${fmt(sug)}</td></tr>`;
  });
  $('tbl-costos').innerHTML = html || '<tr><td colspan="5" class="empty">No hay productos.</td></tr>';
}
function renderInsumos() {
  const q = $('ci-buscar').value.trim().toLowerCase();
  const usos = new Map();
  S.recetas.forEach(l => usos.set(l.insumoId, (usos.get(l.insumoId) || 0) + 1));
  const list = [...S.insumos].filter(i => !q || i.nombre.toLowerCase().includes(q)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  $('tbl-insumos').innerHTML = list.map(i => `<tr>
      <td>${esc(i.nombre)}${i.costo === null ? ' <span class="chip pend">sin precio</span>' : ''}</td>
      <td>${esc(i.unidad || '')}</td>
      <td class="amt"><input type="number" class="inline" data-costo="${i.id}" value="${i.costo ?? ''}" min="0" step="0.01" inputmode="decimal" aria-label="Precio de ${esc(i.nombre)}"></td>
      <td class="hide-sm num">${fDate(i.actualizado || '')}</td>
      <td class="hide-sm">${usos.get(i.id) ? usos.get(i.id) + ' producto' + (usos.get(i.id) === 1 ? '' : 's') : '<span class="muted">—</span>'}</td>
      <td class="amt">${usos.get(i.id) ? '' : `<button class="btn ghost small" data-borrari="${i.id}">Borrar</button>`}</td></tr>`).join('');
}
async function guardarPrecioInsumo(inp) {
  const ins = S.insumos.find(i => i.id === inp.dataset.costo);
  if (!ins) return;
  const v = inp.value.trim() === '' ? null : Number(inp.value.replace(',', '.'));
  if (v === ins.costo || (v !== null && isNaN(v))) return;
  const antes = Calc.costosTodos(S);
  await api('PUT', '/api/insumos/' + ins.id, { ...ins, costo: v });
  const afectados = Calc.productosQueUsan(S, ins.id).map(p => {
    const a = antes.get(p.id).costoUnit, d = C.costos.get(p.id).costoUnit;
    return a !== null && d !== null ? `${p.nombre} ${fmt(a)} → ${fmt(d)}` : p.nombre;
  });
  toast(`${ins.nombre}: ${fmt(v)}.` + (afectados.length ? ` Cambia el costo de ${afectados.length} producto${afectados.length === 1 ? '' : 's'}.` : ''));
}

function abrirEditor(id, copiaDe) {
  const base = id ? C.idx.productos.get(id) : copiaDe ? C.idx.productos.get(copiaDe) : null;
  const recetaDe = id || copiaDe;
  editorProd = {
    id: id || null,
    receta: recetaDe ? S.recetas.filter(l => l.productoId === recetaDe).map(l => ({ insumoId: l.insumoId, cantidad: l.cantidad })) : []
  };
  $('pe-titulo').textContent = id ? base.nombre : copiaDe ? 'Nuevo producto (copia)' : 'Nuevo producto';
  $('pe-nombre').value = base ? base.nombre + (copiaDe ? ' (copia)' : '') : '';
  $('pe-cat').value = base ? base.categoria || '' : '';
  $('pe-tipo').value = base ? base.tipo : 'propio';
  $('pe-unidad').value = base ? base.unidad || '' : '';
  $('pe-rinde').value = base && base.rinde !== null ? base.rinde : '';
  $('pe-precio').value = base && base.precio !== null ? base.precio : '';
  $('pe-precio-may').value = base && base.precioMayorista !== null ? base.precioMayorista : '';
  $('pe-recargo').value = base && base.recargo !== null ? Math.round(base.recargo * 100) : 100;
  $('pe-min').value = base && base.stockMinimo !== null ? base.stockMinimo : '';
  $('pe-notas').value = base ? base.notas || '' : '';
  $('pe-activo').checked = base ? base.activo : true;
  $('pe-borrar').style.display = id ? '' : 'none';
  $('pe-duplicar').style.display = id ? '' : 'none';
  $('prod-editor').style.display = '';
  renderReceta();
  $('prod-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function cerrarEditor() {
  editorProd = null;
  $('prod-editor').style.display = 'none';
}
function renderReceta() {
  const ins = [...S.insumos].sort((a, b) => a.nombre.localeCompare(b.nombre));
  $('pe-receta').innerHTML = editorProd.receta.map((l, i) => {
    const x = C.idx.insumos.get(l.insumoId);
    return `<div class="item" data-i="${i}">
      <select data-f="insumoId" aria-label="Insumo"><option value="">Insumo…</option>${ins.map(o => `<option value="${esc(o.id)}"${o.id === l.insumoId ? ' selected' : ''}>${esc(o.nombre)}${o.unidad ? ' (' + esc(o.unidad) + ')' : ''}</option>`).join('')}</select>
      <input type="number" data-f="cantidad" value="${l.cantidad ?? ''}" min="0" step="any" inputmode="decimal" aria-label="Cantidad" placeholder="${x && x.unidad ? esc(x.unidad) : 'cant.'}">
      <span class="num amt" data-linea="${i}"></span>
      <button class="x" data-quitarr="${i}" aria-label="Quitar">×</button></div>`;
  }).join('') || '<div class="empty">Sin receta. Agregá los insumos de una tanda.</div>';
  renderEditorCalc();
}
// Recalcula en vivo con lo que hay en el formulario (sin guardar), usando calc.js.
function renderEditorCalc() {
  if (!editorProd) return;
  const rinde = numVal('pe-rinde'), precio = numVal('pe-precio'), recargo = numVal('pe-recargo');
  const tmpId = '__editor__';
  const st = {
    ...S,
    productos: [...S.productos, { id: tmpId, rinde, activo: true }],
    recetas: editorProd.receta.filter(l => l.insumoId && l.cantidad > 0).map((l, i) => ({ id: 't' + i, productoId: tmpId, ...l }))
  };
  const c = Calc.costoProducto(st, tmpId);
  editorProd.receta.forEach((l, i) => {
    const el = document.querySelector(`[data-linea="${i}"]`);
    const x = C.idx.insumos.get(l.insumoId);
    if (el) el.textContent = x && x.costo !== null && l.cantidad > 0 ? fmt(x.costo * l.cantidad) : (x && x.costo === null ? 'sin precio' : '');
  });
  const m = Calc.margen(precio, c.costoUnit);
  const sug = Calc.precioSugerido(c.costoUnit, recargo === null ? 1 : recargo / 100);
  const u = $('pe-unidad').value.trim() || 'unidad';
  const box = (l, v, cls) => `<div><div class="l">${l}</div><div class="v num ${cls || ''}">${v}</div></div>`;
  $('pe-calc').innerHTML =
    box('Costo de la tanda', fmt(c.costoTanda)) +
    box(`Costo por ${esc(u)}`, fmt(c.costoUnit)) +
    box('Precio sugerido', fmt(sug)) +
    box('Ganancia por ' + esc(u), m ? fmt(m.ganancia) : '—', m && m.ganancia < 0 ? 'bad' : '') +
    box('Margen', m ? pct(m.margen) : '—', m && m.margen < 0.3 ? 'bad' : '') +
    box('Markup', m && m.markup !== null ? pct(m.markup) : '—');
  const faltan = [...c.problemas.filter(p => p !== 'producto inexistente'), ...c.avisos];
  $('pe-rinde-hint').innerHTML = ($('pe-tipo').value === 'reventa'
    ? 'Reventa: la "receta" es lo que comprás (ej. 1 caja) y el rinde, cuántas unidades vendés de eso.'
    : 'Rinde: cuántas unidades de venta salen de una tanda de la receta (ej. 10 docenas).') +
    (faltan.length ? ` <span class="warn">Falta: ${esc(faltan.join('; '))}.</span>` : '');
}
async function guardarProducto() {
  const recargo = numVal('pe-recargo');
  const body = {
    nombre: $('pe-nombre').value, categoria: $('pe-cat').value, tipo: $('pe-tipo').value, unidad: $('pe-unidad').value,
    rinde: numVal('pe-rinde'), precio: numVal('pe-precio'), precioMayorista: numVal('pe-precio-may'),
    recargo: recargo === null ? null : recargo / 100, stockMinimo: numVal('pe-min'), notas: $('pe-notas').value,
    activo: $('pe-activo').checked,
    receta: editorProd.receta.filter(l => l.insumoId).map(l => ({ insumoId: l.insumoId, cantidad: l.cantidad }))
  };
  if (body.receta.some(l => !(l.cantidad > 0))) return toast('Revisá las cantidades de la receta.', true);
  const r = editorProd.id ? await api('PUT', '/api/productos/' + editorProd.id, body) : await api('POST', '/api/productos', body);
  toast('Producto guardado.');
  if (!editorProd.id && r.id) editorProd.id = r.id;
  abrirEditor(editorProd.id);
}

/* ================= RESULTADOS ================= */

RENDER.resultados = function () {
  const anios = [...new Set([...S.ventas, ...S.gastos].map(x => x.fecha.slice(0, 4)).concat([hoy().slice(0, 4)]))].sort().reverse();
  fillSelect($('r-anio'), anios);
  if (!$('r-anio').value) $('r-anio').value = hoy().slice(0, 4);
  const anio = $('r-anio').value;
  const meses = Calc.porMes(S, anio).filter(m => m.cantVentas || m.gastosTotal);
  const tot = Calc.resumen(S, Calc.rangoAnio(anio));
  const fila = (label, m, cls) => `<tr class="${cls || ''}"><td>${label}</td>
    <td class="amt num">${fmt(m.ventasTotal)}</td><td class="amt num hide-sm">${fmt(m.porGrupo['Mercadería'])}</td>
    <td class="amt num hide-sm">${fmt(m.porGrupo['Fijos'])}</td><td class="amt num hide-sm">${fmt(m.porGrupo['Otros'])}</td>
    <td class="amt num">${fmt(m.gastosTotal)}</td><td class="amt num ${m.resultado < 0 ? 'bad' : 'good'}">${fmt(m.resultado)}</td>
    <td class="amt num">${pct(m.margenTeorico)}</td></tr>`;
  $('tbl-resultados').innerHTML = meses.length
    ? `<thead><tr><th>Mes</th><th class="amt">Ventas</th><th class="amt hide-sm">Mercadería</th><th class="amt hide-sm">Fijos</th><th class="amt hide-sm">Otros</th><th class="amt">Egresos</th><th class="amt">Resultado</th><th class="amt">Margen teór.</th></tr></thead><tbody>` +
      meses.map(m => fila(mesLabel(m.mes), m)).join('') + fila('Total ' + anio, tot, 'total') + '</tbody>'
    : '<tbody><tr><td class="empty">Sin movimientos en este año.</td></tr></tbody>';

  // Selector de período para rentabilidad: meses con ventas + años.
  const conVentas = [...new Set(S.ventas.map(v => v.fecha.slice(0, 7)))].sort().reverse();
  const sel = $('r-periodo');
  const prev = sel.value;
  sel.innerHTML = anios.map(a => `<option value="${a}">Año ${a}</option>`).join('') + conVentas.map(m => `<option value="${m}">${mesLabel(m)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === prev) ? prev : (conVentas.includes(mesActual()) ? mesActual() : anio);
  const per = sel.value;
  const rango = per.length === 4 ? Calc.rangoAnio(per) : Calc.rangoMes(per);
  const pp = Calc.porProducto(S, rango);
  $('tbl-rent-prod').innerHTML = pp.map(x => `<tr><td>${esc(prodNombre(x.productoId))}</td><td class="amt num">${fmtQ(x.cantidad)}</td>
      <td class="amt num">${fmt(x.ingresos)}</td><td class="amt num hide-sm">${x.ingresosConCosto ? fmt(x.costo) : '—'}</td>
      <td class="amt num">${x.ingresosConCosto ? fmt(x.ganancia) : '—'}</td><td class="amt num">${pct(x.margen)}</td></tr>`).join('') +
    (pp.length ? `<tr class="total"><td>Total</td><td></td><td class="amt num">${fmt(Calc.sum(pp, x => x.ingresos))}</td><td class="amt num hide-sm">${fmt(Calc.sum(pp, x => x.costo))}</td><td class="amt num">${fmt(Calc.sum(pp, x => x.ganancia))}</td><td></td></tr>` : '');
  $('rent-prod-empty').style.display = pp.length ? 'none' : '';
  const rr = Calc.resumen(S, rango);
  $('rent-prod-nota').innerHTML = rr.ventasSinDetalle > 0
    ? `Además hubo ${fmt(rr.ventasSinDetalle)} en ventas sin productos cargados (no se pueden repartir por producto).` : '';
  const cats = Object.entries(rr.porCategoria).sort((a, b) => b[1] - a[1]);
  $('tbl-rent-gastos').innerHTML = cats.length
    ? `<thead><tr><th>Categoría</th><th>Grupo</th><th class="amt">Monto</th><th class="amt">% de ventas</th></tr></thead><tbody>` +
      cats.map(([c, m]) => `<tr><td>${esc(c)}</td><td class="muted">${esc(Calc.grupoDe(S, c))}</td><td class="amt num">${fmt(m)}</td><td class="amt num">${rr.ventasTotal ? pct(m / rr.ventasTotal) : '—'}</td></tr>`).join('') +
      `<tr class="total"><td colspan="2">Total</td><td class="amt num">${fmt(rr.gastosTotal)}</td><td class="amt num">${rr.ventasTotal ? pct(rr.gastosTotal / rr.ventasTotal) : '—'}</td></tr></tbody>`
    : '<tbody><tr><td class="empty">Sin egresos en este período.</td></tr></tbody>';
};

/* ================= CLIENTES ================= */

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
RENDER.clientes = function () {
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
};

/* ================= CONFIGURACIÓN ================= */

RENDER.config = function () {
  const usos = new Map();
  S.gastos.forEach(g => usos.set(g.categoria, (usos.get(g.categoria) || 0) + 1));
  $('tbl-cats').innerHTML = S.categoriasGasto.map(c => `<tr><td>${esc(c.nombre)} <span class="hint">${usos.get(c.nombre) || 0} gastos</span></td>
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
  $('imp-result').innerHTML = `<div class="alert${hecho ? '' : ''}"><b>${hecho ? 'Importado' : 'Se importaría'}:</b> ${x.productos} productos, ${x.insumos} insumos, ${x.recetas} renglones de receta,
    ${x.producciones} producciones, ${x.ventas} ventas (${fmt(x.totalVentas)}), ${x.gastos} gastos (${fmt(x.totalGastos)}), ${x.clientes} clientes, ${x.ajustes} ajustes de stock.</div>
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

document.addEventListener('click', async e => {
  const t = e.target.closest('button, [data-editp]');
  if (!t) return;
  const d = t.dataset;
  if (d.tab) return showTab(d.tab);
  if (d.goto) return showTab(d.goto);
  if (d.mes) { inicioMes = moverMes(inicioMes, Number(d.mes)); return render(); }
  if (d.vmes) { ventasMes = moverMes(ventasMes, Number(d.vmes)); $('ventas-pend').checked = false; return render(); }
  if (d.gmes) { gastosMes = moverMes(gastosMes, Number(d.gmes)); return render(); }
  if (d.pmes) { prodMes = moverMes(prodMes, Number(d.pmes)); return render(); }
  // ventas
  if (d.quitar !== undefined) { ventaItems.splice(Number(d.quitar), 1); if (!ventaItems.length) ventaItems.push(nuevoRenglon()); return renderVentaForm(); }
  if (d.editv) return editarVenta(d.editv);
  if (d.borrarv) {
    const v = S.ventas.find(x => x.id === d.borrarv);
    if (v && confirm(`¿Borrar la venta del ${fDate(v.fecha)}${v.clienteId ? ' a ' + cliNombre(v.clienteId) : ''} por ${fmt(v.total)}?`)) {
      await api('DELETE', '/api/ventas/' + v.id).catch(() => {});
      if (ventaEditId === v.id) resetVentaForm();
    }
    return;
  }
  if (d.cobro) {
    const v = S.ventas.find(x => x.id === d.cobro);
    if (v) await api('PATCH', `/api/ventas/${v.id}/cobro`, { estadoPago: v.estadoPago === 'pagado' ? 'pendiente' : 'pagado' }).catch(() => {});
    return;
  }
  if (t.parentElement && t.parentElement.id === 'v-estado') { ventaEstado = d.v; return renderVentaForm(); }
  // gastos
  if (d.editg) return editarGasto(d.editg);
  if (d.borrarg) {
    const g = S.gastos.find(x => x.id === d.borrarg);
    if (g && confirm(`¿Borrar el gasto de ${g.categoria} del ${fDate(g.fecha)} por ${fmt(g.monto)}?`)) await api('DELETE', '/api/gastos/' + g.id).catch(() => {});
    return;
  }
  // producción / stock
  if (d.borrarp) {
    const p = S.producciones.find(x => x.id === d.borrarp);
    if (p && confirm(`¿Borrar la producción de ${fmtQ(p.cantidad)} ${prodNombre(p.productoId)} del ${fDate(p.fecha)}?`)) await api('DELETE', '/api/producciones/' + p.id).catch(() => {});
    return;
  }
  if (d.ajustar) { $('a-prod').value = d.ajustar; $('a-cant').focus(); $('ajuste-panel').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.borrara) {
    if (confirm('¿Borrar este ajuste de stock?')) await api('DELETE', '/api/ajustes/' + d.borrara).catch(() => {});
    return;
  }
  // costos
  if (t.parentElement && t.parentElement.id === 'costos-seg') { costosVista = d.v; return render(); }
  if (d.editp) return abrirEditor(d.editp);
  if (d.quitarr !== undefined) { editorProd.receta.splice(Number(d.quitarr), 1); return renderReceta(); }
  if (d.borrari) {
    const i = S.insumos.find(x => x.id === d.borrari);
    if (i && confirm(`¿Borrar el insumo ${i.nombre}?`)) await api('DELETE', '/api/insumos/' + i.id).catch(() => {});
    return;
  }
  // clientes
  if (d.editc) return editarCliente(d.editc);
  if (d.borrarc) {
    const c = S.clientes.find(x => x.id === d.borrarc);
    if (c && confirm(`¿Borrar a ${c.nombre}?`)) await api('DELETE', '/api/clientes/' + c.id).catch(() => {});
    return;
  }
  // config
  if (d.renombrar) {
    const nuevo = prompt('Nuevo nombre para la categoría (se actualizan los gastos que la usan):', d.renombrar);
    if (nuevo && nuevo.trim() && nuevo.trim() !== d.renombrar) await api('PUT', '/api/categorias-gasto/' + encodeURIComponent(d.renombrar), { nuevoNombre: nuevo.trim() }).catch(() => {});
    return;
  }
  if (d.borrarcat) {
    if (confirm(`¿Borrar la categoría ${d.borrarcat}?`)) await api('DELETE', '/api/categorias-gasto/' + encodeURIComponent(d.borrarcat)).catch(() => {});
  }
});

// Formulario de venta: cambios en renglones.
$('v-items').addEventListener('input', e => {
  const row = e.target.closest('.item');
  if (!row) return;
  const it = ventaItems[Number(row.dataset.i)];
  const f = e.target.dataset.f;
  if (f === 'productoId') {
    it.productoId = e.target.value;
    it.precioUnit = precioPara(C.idx.productos.get(it.productoId));
    it.precioTocado = false;
    const esUltimo = Number(row.dataset.i) === ventaItems.length - 1;
    if (esUltimo && it.productoId) ventaItems.push(nuevoRenglon());
    renderVentaForm();
    return;
  }
  const v = e.target.value.trim() === '' ? null : Number(e.target.value.replace(',', '.'));
  it[f] = v;
  if (f === 'precioUnit') it.precioTocado = true;
  // actualizar total y subtotal sin redibujar (para no perder el foco)
  $('v-total').textContent = fmt(Calc.sum(ventaItems, x => (x.cantidad || 0) * (x.precioUnit || 0)));
  const sub = row.querySelector('.sub');
  if (sub) sub.innerHTML = sub.innerHTML.replace(/Subtotal [^<]*$/, 'Subtotal ' + fmt((it.cantidad || 0) * (it.precioUnit || 0)));
});
$('v-items').addEventListener('change', e => { if (e.target.dataset.f === 'cantidad') renderVentaForm(); });
$('v-cliente').addEventListener('input', () => {
  // Si cambia el tipo de cliente, se actualizan los precios que no se tocaron a mano.
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

$('g-guardar').addEventListener('click', e => guardando(e.target, guardarGasto));
$('g-cancelar').addEventListener('click', resetGastoForm);
$('gastos-mes').addEventListener('change', e => { if (e.target.value) { gastosMes = e.target.value; render(); } });

$('p-prod').addEventListener('change', renderProdInfo);
$('p-guardar').addEventListener('click', e => guardando(e.target, guardarProduccion));
$('prod-mes').addEventListener('change', e => { if (e.target.value) { prodMes = e.target.value; render(); } });

$('s-todos').addEventListener('change', render);
$('s-conteo-btn').addEventListener('click', () => { modoConteo = true; render(); });
$('s-conteo-cancelar').addEventListener('click', () => { modoConteo = false; render(); });
$('s-conteo-guardar').addEventListener('click', e => guardando(e.target, guardarConteo));
$('a-guardar').addEventListener('click', e => guardando(e.target, guardarAjuste));

$('cp-buscar').addEventListener('input', renderCostosProductos);
$('cp-cat').addEventListener('change', renderCostosProductos);
$('ci-buscar').addEventListener('input', renderInsumos);
$('cp-nuevo').addEventListener('click', () => abrirEditor(null));
$('tbl-insumos').addEventListener('change', e => { if (e.target.dataset.costo) guardarPrecioInsumo(e.target).catch(() => {}); });
$('tbl-insumos').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.costo) e.target.blur(); });
$('ci-guardar').addEventListener('click', e => guardando(e.target, async () => {
  await api('POST', '/api/insumos', { nombre: $('ci-nombre').value, unidad: $('ci-unidad').value, costo: numVal('ci-costo') });
  toast('Insumo agregado.');
  ['ci-nombre', 'ci-unidad', 'ci-costo'].forEach(id => { $(id).value = ''; });
}));
$('pe-receta').addEventListener('input', e => {
  const row = e.target.closest('.item');
  if (!row) return;
  const l = editorProd.receta[Number(row.dataset.i)];
  if (e.target.dataset.f === 'insumoId') { l.insumoId = e.target.value; return renderReceta(); }
  l.cantidad = e.target.value.trim() === '' ? null : Number(e.target.value.replace(',', '.'));
  renderEditorCalc();
});
['pe-rinde', 'pe-precio', 'pe-recargo', 'pe-unidad', 'pe-tipo'].forEach(id => $(id).addEventListener('input', renderEditorCalc));
$('pe-add').addEventListener('click', () => { editorProd.receta.push({ insumoId: '', cantidad: null }); renderReceta(); });
$('pe-guardar').addEventListener('click', e => guardando(e.target, guardarProducto));
$('pe-cerrar').addEventListener('click', cerrarEditor);
$('pe-duplicar').addEventListener('click', () => abrirEditor(null, editorProd.id));
$('pe-borrar').addEventListener('click', e => guardando(e.target, async () => {
  if (!confirm('¿Borrar este producto y su receta?')) return;
  await api('DELETE', '/api/productos/' + editorProd.id);
  cerrarEditor();
  toast('Producto borrado.');
}));

$('r-anio').addEventListener('change', render);
$('r-periodo').addEventListener('change', render);

$('c-guardar').addEventListener('click', e => guardando(e.target, guardarCliente));
$('c-cancelar').addEventListener('click', resetClienteForm);
$('c-buscar').addEventListener('input', render);

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

// Selects de medio de pago.
[$('v-medio'), $('g-medio')].forEach(sel => fillSelect(sel, MEDIOS, '—'));

try { tabActual = localStorage.getItem('kasa-tab') || 'inicio'; } catch { /* sin storage */ }
if (!RENDER[tabActual]) tabActual = 'inicio';
document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabActual));
document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tabActual));
start();
