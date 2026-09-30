// Ingreso con un único usuario y contraseña (la app la usa solo la dueña).
// Usuario y clave salen de variables de entorno (APP_USUARIO / APP_CLAVE);
// al ingresar queda una cookie de sesión firmada con HMAC (SESSION_SECRET).
//
// En Vercel APP_CLAVE y SESSION_SECRET son obligatorias: el repo es público,
// así que un secreto por defecto permitiría fabricar cookies válidas.
// En local, si no hay APP_CLAVE, se entra con cualquier clave (solo desarrollo).

const crypto = require('node:crypto');
const { ApiError } = require('./lib.js');

const COOKIE = 'kasa_session';
const MAX_AGE_S = 60 * 24 * 3600; // 60 días

const isProd = () => !!process.env.VERCEL;

function secret() {
  const s = envLimpio('SESSION_SECRET');
  if (s) return s;
  if (isProd()) throw new ApiError(500, 'Falta configurar SESSION_SECRET en Vercel.');
  return 'kasa-norte-desarrollo-local';
}

function hmac(s) {
  return crypto.createHmac('sha256', secret()).update(s).digest('base64url');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Limpia valores pegados en Vercel con espacios, saltos de línea o comillas alrededor
// ("miclave" o 'miclave' → miclave), que es el error más común al cargarlos.
function envLimpio(nombre) {
  const v = String(process.env[nombre] || '').trim();
  const m = /^(["'])(.*)\1$/.exec(v);
  return (m ? m[2] : v).trim();
}

function usuario() {
  return envLimpio('APP_USUARIO') || 'kasa';
}

// Devuelve true si usuario y clave coinciden con las del entorno.
function checkCredentials(user, pass) {
  const clave = envLimpio('APP_CLAVE');
  if (!clave) {
    if (isProd()) throw new ApiError(500, 'Falta configurar APP_CLAVE en Vercel.');
    return true; // desarrollo local sin clave configurada
  }
  // Se comparan las dos cosas siempre, para no revelar cuál falló por el tiempo de respuesta.
  const okUser = safeEqual(String(user || '').trim().toLowerCase(), usuario().toLowerCase());
  const okPass = safeEqual(String(pass || '').trim(), clave);
  return okUser && okPass;
}

function sessionCookie(req) {
  const payload = Buffer.from(JSON.stringify({ u: usuario(), e: Date.now() + MAX_AGE_S * 1000 })).toString('base64url');
  const token = payload + '.' + hmac(payload);
  const secure = isProd() || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`;
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// Devuelve { user } o null si no hay sesión válida.
function readSession(req) {
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig || !safeEqual(sig, hmac(payload))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!data.u || !(data.e > Date.now())) return null;
  return { user: data.u };
}

// Qué está configurado (sí/no, nunca los valores), para diagnosticar un deploy.
function diagnostico() {
  let cuentaServicio = null;
  try { cuentaServicio = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').client_email || null; } catch { /* inválido */ }
  return {
    entorno: isProd() ? 'vercel' : 'local',
    usuario: usuario(),
    clave: !!envLimpio('APP_CLAVE'),
    claveTieneComillasOEspacios: String(process.env.APP_CLAVE || '') !== envLimpio('APP_CLAVE'),
    sessionSecret: !!envLimpio('SESSION_SECRET'),
    planilla: !!process.env.GOOGLE_SHEET_ID,
    cuentaServicioJsonValido: !!cuentaServicio,
    cuentaServicio
  };
}

module.exports = { checkCredentials, sessionCookie, clearCookie, readSession, usuario, diagnostico };
