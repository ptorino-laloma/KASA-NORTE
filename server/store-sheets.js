// Backend de producción: la planilla "KASA NORTE" de Google Sheets hace de base de datos.
// Cada tabla es una pestaña "App ...", con una fila de encabezado y una fila por
// registro, para poder abrir la planilla y leer los datos en crudo. Las pestañas
// viejas (COSTOS, STOCK, INGRESOS Y EGRESOS...) no se tocan nunca.
//
// Autenticación con una cuenta de servicio de Google (sin librerías: el JWT se
// firma con node:crypto). Variables de entorno:
//   GOOGLE_SHEET_ID               id de la planilla (lo que va entre /d/ y /edit en la URL)
//   GOOGLE_SERVICE_ACCOUNT_JSON   el JSON completo de la clave de la cuenta de servicio
// La planilla tiene que estar compartida (como Editor) con el client_email de esa cuenta.
//
// Estrategia de escritura: se reescribe la pestaña completa de cada tabla que
// cambió. Primero se escriben las filas nuevas y DESPUÉS se borran las filas
// sobrantes de abajo, para que un corte a mitad de camino nunca deje la pestaña vacía.

const crypto = require('node:crypto');
const { ApiError } = require('./lib.js');

const API = 'https://sheets.googleapis.com/v4/spreadsheets/';

const num = v => (v === '' || v === null || v === undefined) ? 0 : Number(v);
const optNum = v => (v === '' || v === null || v === undefined) ? null : Number(v);
const str = v => (v === null || v === undefined) ? '' : String(v);
const optStr = v => str(v) || null;

// Nombre legible de un producto / insumo / cliente por id (columnas de ayuda para leer la planilla).
const nameOf = (list, id) => (list.find(x => x.id === id) || {}).nombre || '';

// Definición de cada pestaña: encabezados, y cómo pasar del state a filas y viceversa.
// Si agregás un campo, agregalo AL FINAL de headers para no desalinear planillas existentes.
const SHEETS = {
  insumos: {
    title: 'App Insumos',
    headers: ['id', 'nombre', 'unidad', 'costo', 'actualizado', 'notas'],
    toRows: s => s.insumos.map(i => [i.id, i.nombre, i.unidad || '', i.costo ?? '', i.actualizado || '', i.notas || '']),
    fromRows: rows => rows.filter(r => r[0]).map(r => ({
      id: str(r[0]), nombre: str(r[1]), unidad: optStr(r[2]), costo: optNum(r[3]), actualizado: optStr(r[4]), notas: optStr(r[5])
    }))
  },
  productos: {
    title: 'App Productos',
    headers: ['id', 'nombre', 'categoria', 'tipo', 'unidad', 'rinde', 'precio', 'precio_mayorista', 'recargo', 'activo', 'stock_minimo', 'notas'],
    toRows: s => s.productos.map(p => [p.id, p.nombre, p.categoria || '', p.tipo, p.unidad || '', p.rinde ?? '',
      p.precio ?? '', p.precioMayorista ?? '', p.recargo ?? '', p.activo ? 'si' : 'no', p.stockMinimo ?? '', p.notas || '']),
    fromRows: rows => rows.filter(r => r[0]).map(r => ({
      id: str(r[0]), nombre: str(r[1]), categoria: optStr(r[2]), tipo: str(r[3]) || 'propio', unidad: optStr(r[4]),
      rinde: optNum(r[5]), precio: optNum(r[6]), precioMayorista: optNum(r[7]), recargo: optNum(r[8]),
      activo: str(r[9]) !== 'no', stockMinimo: optNum(r[10]), notas: optStr(r[11])
    }))
  },
  recetas: {
    title: 'App Recetas',
    headers: ['id', 'producto_id', 'producto', 'insumo_id', 'insumo', 'cantidad'],
    toRows: s => s.recetas.map(l => [l.id, l.productoId, nameOf(s.productos, l.productoId), l.insumoId, nameOf(s.insumos, l.insumoId), l.cantidad]),
    fromRows: rows => rows.filter(r => r[0]).map(r => ({ id: str(r[0]), productoId: str(r[1]), insumoId: str(r[3]), cantidad: num(r[5]) }))
  },
  producciones: {
    title: 'App Produccion',
    headers: ['id', 'fecha', 'producto_id', 'producto', 'cantidad', 'costo_unitario', 'nota', 'creado'],
    toRows: s => s.producciones.map(p => [p.id, p.fecha, p.productoId, nameOf(s.productos, p.productoId), p.cantidad,
      p.costoUnit ?? '', p.nota || '', p.creado || '']),
    fromRows: rows => rows.filter(r => r[0]).map(r => ({
      id: str(r[0]), fecha: str(r[1]), productoId: str(r[2]), cantidad: num(r[4]), costoUnit: optNum(r[5]),
      nota: optStr(r[6]), creado: str(r[7])
    }))
  },
  ventas: {
    title: 'App Ventas',
    headers: ['id', 'fecha', 'cliente_id', 'cliente', 'total', 'estado_pago', 'medio_pago', 'nota', 'creado'],
    toRows: s => s.ventas.map(v => [v.id, v.fecha, v.clienteId || '', nameOf(s.clientes, v.clienteId), v.total,
      v.estadoPago, v.medioPago || '', v.nota || '', v.creado || '']),
    fromRows: rows => rows.filter(r => r[0]).map(r => ({
      id: str(r[0]), fecha: str(r[1]), clienteId: optStr(r[2]), total: num(r[4]), estadoPago: str(r[5]) || 'pagado',
      medioPago: optStr(r[6]), nota: optStr(r[7]), creado: str(r[8])
    }))
  },
  ventaItems: {
    title: 'App Ventas Detalle',
    headers: ['id', 'venta_id', 'producto_id', 'producto', 'cantidad', 'precio_unitario', 'costo_unitario'],
    toRows: s => s.ventaItems.map(i => [i.id, i.ventaId, i.productoId, nameOf(s.productos, i.productoId), i.cantidad,
      i.precioUnit, i.costoUnit ?? '']),
    fromRows: rows => rows.filter(r => r[0]).map(r => ({
      id: str(r[0]), ventaId: str(r[1]), productoId: str(r[2]), cantidad: num(r[4]), precioUnit: num(r[5]), costoUnit: optNum(r[6])
    }))
  },
  gastos: {
    title: 'App Gastos',
    headers: ['id', 'fecha', 'categoria', 'monto', 'medio_pago', 'estado_pago', 'proveedor', 'nota', 'creado'],
    toRows: s => s.gastos.map(g => [g.id, g.fecha, g.categoria, g.monto, g.medioPago || '', g.estadoPago,
      g.proveedor || '', g.nota || '', g.creado || '']),
    fromRows: rows => rows.filter(r => r[0]).map(r => ({
      id: str(r[0]), fecha: str(r[1]), categoria: str(r[2]), monto: num(r[3]), medioPago: optStr(r[4]),
      estadoPago: str(r[5]) || 'pagado', proveedor: optStr(r[6]), nota: optStr(r[7]), creado: str(r[8])
    }))
  },
  ajustes: {
    title: 'App Ajustes Stock',
    headers: ['id', 'fecha', 'producto_id', 'producto', 'cantidad', 'motivo', 'nota', 'creado'],
    toRows: s => s.ajustes.map(a => [a.id, a.fecha, a.productoId, nameOf(s.productos, a.productoId), a.cantidad,
      a.motivo, a.nota || '', a.creado || '']),
    fromRows: rows => rows.filter(r => r[0]).map(r => ({
      id: str(r[0]), fecha: str(r[1]), productoId: str(r[2]), cantidad: num(r[4]), motivo: str(r[5]),
      nota: optStr(r[6]), creado: str(r[7])
    }))
  },
  clientes: {
    title: 'App Clientes',
    headers: ['id', 'nombre', 'tipo', 'telefono', 'notas'],
    toRows: s => s.clientes.map(c => [c.id, c.nombre, c.tipo, c.telefono || '', c.notas || '']),
    fromRows: rows => rows.filter(r => r[0]).map(r => ({
      id: str(r[0]), nombre: str(r[1]), tipo: str(r[2]) || 'Particular', telefono: optStr(r[3]), notas: optStr(r[4])
    }))
  },
  categoriasGasto: {
    title: 'App Categorias Gasto',
    headers: ['nombre', 'grupo'],
    toRows: s => s.categoriasGasto.map(c => [c.nombre, c.grupo]),
    fromRows: rows => rows.filter(r => r[0]).map(r => ({ nombre: str(r[0]), grupo: str(r[1]) || 'Otros' }))
  }
};

/* ---------- autenticación (JWT de cuenta de servicio) ---------- */

let tokenCache = null;

function credentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new ApiError(500, 'Falta configurar GOOGLE_SERVICE_ACCOUNT_JSON.');
  let c;
  try { c = JSON.parse(raw); } catch { throw new ApiError(500, 'GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido.'); }
  return { email: c.client_email, key: String(c.private_key || '').replace(/\\n/g, '\n') };
}

async function accessToken() {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const { email, key } = credentials();
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature })
  });
  if (!resp.ok) throw new ApiError(502, `Google rechazó la cuenta de servicio (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  tokenCache = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function sheetsFetch(pathAndQuery, options = {}) {
  const resp = await fetch(API + process.env.GOOGLE_SHEET_ID + pathAndQuery, {
    ...options,
    headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!resp.ok) throw new ApiError(502, `Google Sheets respondió ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return resp.json();
}

/* ---------- estructura de la planilla ---------- */

let structureReady = false;

// Crea las pestañas "App ..." que falten (con su encabezado). Se hace una vez por instancia.
// Las demás pestañas de la planilla no se tocan. Si una pestaña con nuestro nombre
// ya existe pero con otro encabezado, se frena todo en vez de pisarla.
async function ensureStructure() {
  if (structureReady) return;
  const meta = await sheetsFetch('?fields=sheets.properties.title');
  const existing = new Set((meta.sheets || []).map(s => s.properties.title));
  const present = Object.values(SHEETS).filter(d => existing.has(d.title));
  if (present.length) {
    const qs = present.map(d => 'ranges=' + encodeURIComponent(`'${d.title}'!1:1`)).join('&');
    const heads = await sheetsFetch(`/values:batchGet?${qs}`);
    present.forEach((d, i) => {
      const got = ((heads.valueRanges[i].values || [])[0] || []).map(String);
      // Se aceptan encabezados viejos a los que después se les agregaron columnas al final.
      if (got.length && got.join('|') !== d.headers.slice(0, got.length).join('|')) {
        throw new ApiError(500, `La pestaña "${d.title}" de la planilla no tiene el formato de la app (encabezado distinto). No la toco para no pisar datos.`);
      }
    });
  }
  const missing = Object.values(SHEETS).filter(d => !existing.has(d.title));
  if (missing.length) {
    await sheetsFetch(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: missing.map(d => ({ addSheet: { properties: { title: d.title } } })) })
    });
    await sheetsFetch('/values:batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: missing.map(d => ({ range: `'${d.title}'!A1`, values: [d.headers] }))
      })
    });
  }
  structureReady = true;
}

/* ---------- load / save ---------- */

async function load() {
  await ensureStructure();
  const keys = Object.keys(SHEETS);
  const qs = keys.map(k => 'ranges=' + encodeURIComponent(`'${SHEETS[k].title}'`)).join('&');
  const data = await sheetsFetch(`/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE`);
  const state = {};
  keys.forEach((k, i) => {
    const rows = (data.valueRanges[i].values || []).slice(1); // sin el encabezado
    state[k] = SHEETS[k].fromRows(rows);
  });
  return state;
}

async function save(state, tables) {
  await ensureStructure();
  const defs = tables.map(t => SHEETS[t]);
  const written = defs.map(d => ({ d, values: [d.headers, ...d.toRows(state)] }));
  await sheetsFetch('/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: written.map(w => ({ range: `'${w.d.title}'!A1`, values: w.values }))
    })
  });
  // Borrar lo que quedó debajo de la última fila escrita (registros eliminados).
  await sheetsFetch('/values:batchClear', {
    method: 'POST',
    body: JSON.stringify({ ranges: written.map(w => `'${w.d.title}'!A${w.values.length + 1}:Z`) })
  });
}

// Lee pestañas viejas tal cual (valores calculados, fechas como número de serie),
// para la importación inicial. Las que no existan vuelven como null.
async function readRaw(titles) {
  const meta = await sheetsFetch('?fields=sheets.properties.title');
  const existing = new Set((meta.sheets || []).map(s => s.properties.title));
  const present = titles.filter(t => existing.has(t));
  const out = {};
  titles.forEach(t => { out[t] = null; });
  if (!present.length) return out;
  const qs = present.map(t => 'ranges=' + encodeURIComponent(`'${t}'`)).join('&');
  const data = await sheetsFetch(`/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  present.forEach((t, i) => { out[t] = data.valueRanges[i].values || []; });
  return out;
}

module.exports = { load, save, readRaw, name: 'Google Sheets', SHEETS };
