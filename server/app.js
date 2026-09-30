// Manejo de /api/* compartido entre el servidor local (server/index.js) y la
// función de Vercel (api/handler.js). No sirve archivos estáticos.
const routes = require('./routes.js');
const store = require('./store.js');
const auth = require('./auth.js');
const { importar, TABS } = require('./importer.js');
const { ApiError } = require('./lib.js');

// [método, patrón, tablas que modifica, handler, status]
// Toda ruta requiere sesión. Si modifica algo, DECLARÁ las tablas o no se guarda.
const ROUTES = [
  ['GET', '/api/state', null, c => routes.getState(c.state, c.session)],

  ['POST', '/api/ventas', ['ventas', 'ventaItems', 'clientes'], c => routes.createVenta(c.state, c.body), 201],
  ['PUT', '/api/ventas/:id', ['ventas', 'ventaItems', 'clientes'], c => routes.updateVenta(c.state, c.params.id, c.body)],
  ['PATCH', '/api/ventas/:id/cobro', ['ventas'], c => routes.setCobro(c.state, c.params.id, c.body)],
  ['DELETE', '/api/ventas/:id', ['ventas', 'ventaItems'], c => routes.deleteVenta(c.state, c.params.id)],

  ['POST', '/api/gastos', ['gastos', 'compraItems', 'insumos'], c => routes.createGasto(c.state, c.body), 201],
  ['PUT', '/api/gastos/:id', ['gastos', 'compraItems', 'insumos'], c => routes.updateGasto(c.state, c.params.id, c.body)],
  ['DELETE', '/api/gastos/:id', ['gastos', 'compraItems'], c => routes.deleteGasto(c.state, c.params.id)],

  ['POST', '/api/producciones', ['producciones'], c => routes.createProduccion(c.state, c.body), 201],
  ['DELETE', '/api/producciones/:id', ['producciones'], c => routes.deleteProduccion(c.state, c.params.id)],

  ['POST', '/api/ajustes', ['ajustes'], c => routes.createAjuste(c.state, c.body), 201],
  ['POST', '/api/stock/conteo', ['ajustes'], c => routes.conteoStock(c.state, c.body), 201],
  ['DELETE', '/api/ajustes/:id', ['ajustes'], c => routes.deleteAjuste(c.state, c.params.id)],
  ['POST', '/api/ajustes-insumo', ['ajustesInsumo'], c => routes.createAjusteInsumo(c.state, c.body), 201],
  ['POST', '/api/stock-insumos/conteo', ['ajustesInsumo'], c => routes.conteoInsumos(c.state, c.body), 201],
  ['DELETE', '/api/ajustes-insumo/:id', ['ajustesInsumo'], c => routes.deleteAjusteInsumo(c.state, c.params.id)],

  ['POST', '/api/insumos/familias', ['insumos'], c => routes.asignarFamiliasInsumos(c.state, c.body)],
  ['POST', '/api/insumos', ['insumos'], c => routes.createInsumo(c.state, c.body), 201],
  ['PUT', '/api/insumos/:id', ['insumos'], c => routes.updateInsumo(c.state, c.params.id, c.body)],
  ['DELETE', '/api/insumos/:id', ['insumos'], c => routes.deleteInsumo(c.state, c.params.id)],

  ['POST', '/api/productos', ['productos', 'recetas'], c => routes.createProducto(c.state, c.body), 201],
  ['PUT', '/api/productos/:id', ['productos', 'recetas'], c => routes.updateProducto(c.state, c.params.id, c.body)],
  ['DELETE', '/api/productos/:id', ['productos', 'recetas'], c => routes.deleteProducto(c.state, c.params.id)],

  ['PUT', '/api/productos/:id/receta', ['productos', 'recetas'], c => routes.updateReceta(c.state, c.params.id, c.body)],

  ['POST', '/api/otros-ingresos', ['otrosIngresos'], c => routes.createOtroIngreso(c.state, c.body), 201],
  ['PUT', '/api/otros-ingresos/:id', ['otrosIngresos'], c => routes.updateOtroIngreso(c.state, c.params.id, c.body)],
  ['DELETE', '/api/otros-ingresos/:id', ['otrosIngresos'], c => routes.deleteOtroIngreso(c.state, c.params.id)],

  ['POST', '/api/familias', ['familias'], c => routes.createFamilia(c.state, c.body), 201],
  ['PUT', '/api/familias/:tipo/:nombre', ['familias', 'productos', 'insumos'], c => routes.updateFamilia(c.state, c.params.tipo, c.params.nombre, c.body)],
  ['DELETE', '/api/familias/:tipo/:nombre', ['familias'], c => routes.deleteFamilia(c.state, c.params.tipo, c.params.nombre)],

  ['POST', '/api/clientes', ['clientes'], c => routes.createCliente(c.state, c.body), 201],
  ['PUT', '/api/clientes/:id', ['clientes'], c => routes.updateCliente(c.state, c.params.id, c.body)],
  ['DELETE', '/api/clientes/:id', ['clientes'], c => routes.deleteCliente(c.state, c.params.id)],

  ['POST', '/api/categorias-gasto', ['categoriasGasto'], c => routes.createCategoriaGasto(c.state, c.body), 201],
  ['PUT', '/api/categorias-gasto/:nombre', ['categoriasGasto', 'gastos'], c => routes.updateCategoriaGasto(c.state, c.params.nombre, c.body)],
  ['DELETE', '/api/categorias-gasto/:nombre', ['categoriasGasto'], c => routes.deleteCategoriaGasto(c.state, c.params.nombre)],

];

const DATOS_PROPIOS = ['insumos', 'productos', 'producciones', 'ventas', 'gastos', 'clientes', 'otrosIngresos'];

async function leerPlanillaVieja(state) {
  const raw = await store.readRaw(TABS);
  try {
    return importar(raw, { hoy: routes.getState(state, { user: '' }).config.hoy });
  } catch (e) {
    throw new ApiError(400, 'No pude leer la planilla vieja: ' + e.message);
  }
}

// Migración automática: la primera vez que se abre la app con la base vacía se traen
// los datos de las pestañas viejas de la misma planilla (sin modificarlas). Si la
// planilla no tiene esas pestañas, no hace nada. Devuelve el resumen o null.
async function migrarSiHaceFalta(state) {
  if (!DATOS_PROPIOS.every(t => !state[t].length)) return null;
  let r;
  try { r = await leerPlanillaVieja(state); } catch (e) { console.warn('Migración salteada:', e.message); return null; }
  store.TABLES.forEach(t => { state[t] = r.data[t]; });
  await store.save(state, store.TABLES);
  return { resumen: r.resumen, avisos: r.avisos };
}

function matchRoute(pattern, pathname) {
  const pParts = pattern.split('/').filter(Boolean);
  const parts = pathname.split('/').filter(Boolean);
  if (pParts.length !== parts.length) return null;
  const params = {};
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i].startsWith(':')) params[pParts[i].slice(1)] = decodeURIComponent(parts[i]);
    else if (pParts[i] !== parts[i]) return null;
  }
  return params;
}

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function readJsonBody(req) {
  // En Vercel el body ya viene leído en req.body; localmente hay que leer el stream.
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) req.body = req.body.toString('utf8');
    if (typeof req.body === 'string') {
      try { return Promise.resolve(req.body ? JSON.parse(req.body) : {}); }
      catch { return Promise.reject(new ApiError(400, 'JSON inválido.')); }
    }
    return Promise.resolve(req.body || {});
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new ApiError(413, 'Body demasiado grande.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function handleApi(req, res, pathname) {
  const method = req.method;

  // Rutas públicas: lo mínimo para la pantalla de ingreso.
  if (method === 'GET' && pathname === '/api/login') {
    return sendJson(res, 200, { session: auth.readSession(req), usuario: auth.usuario() });
  }
  if (method === 'POST' && pathname === '/api/login') {
    const body = await readJsonBody(req);
    if (!auth.checkCredentials(body.usuario, body.clave)) {
      await sleep(800); // frena un poco los intentos a ciegas
      throw new ApiError(401, 'Usuario o contraseña incorrectos.');
    }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(req) });
  }
  // Diagnóstico de configuración (sin valores secretos): qué variables están cargadas.
  if (method === 'GET' && pathname === '/api/diagnostico') {
    return sendJson(res, 200, auth.diagnostico());
  }
  if (method === 'POST' && pathname === '/api/logout') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  let route, params;
  for (const r of ROUTES) {
    if (r[0] === method && (params = matchRoute(r[1], pathname))) { route = r; break; }
  }
  if (!route) throw new ApiError(404, 'Ruta no encontrada.');
  const [, , writes, handler, status = 200] = route;

  const session = auth.readSession(req);
  if (!session) throw new ApiError(401, 'Tenés que ingresar de nuevo.');

  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readJsonBody(req) : {};
  const state = await store.load();

  const migracion = method === 'GET' && pathname === '/api/state' ? await migrarSiHaceFalta(state) : null;
  const out = await handler({ state, params, body, session });
  if (migracion) out.migracion = migracion;
  if (!writes) return sendJson(res, status, out === undefined ? { ok: true } : out);
  await store.save(state, writes);
  // Después de escribir se devuelve el state completo: el frontend lo usa directo.
  return sendJson(res, status, { ok: true, ...(out || {}), state: routes.getState(state, session) });
}

// Punto de entrada: nunca deja escapar una excepción sin responder.
async function handle(req, res, pathname) {
  try {
    await handleApi(req, res, pathname);
  } catch (e) {
    if (e instanceof ApiError) sendJson(res, e.status, { error: e.message });
    else { console.error(e); sendJson(res, 500, { error: 'Error interno del servidor.' }); }
  }
}

module.exports = { handle };
