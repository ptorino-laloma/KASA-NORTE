const crypto = require('node:crypto');

// Categorías de gasto iniciales (las de la planilla vieja, pestaña "Base de datos").
// grupo: 'Mercadería' = compras que van a producción (insumos, reventa, descartables)
//        'Fijos'      = estructura que se paga igual se venda o no (sueldos, impuestos)
//        'Otros'      = lo que no encaja en lo anterior
// Se usa para agrupar el estado de resultados. Se edita desde Configuración.
const DEFAULT_CATEGORIAS_GASTO = [
  { nombre: 'Carniceria', grupo: 'Mercadería' },
  { nombre: 'Verduleria', grupo: 'Mercadería' },
  { nombre: 'Super', grupo: 'Mercadería' },
  { nombre: 'Masas', grupo: 'Mercadería' },
  { nombre: 'Congelados', grupo: 'Mercadería' },
  { nombre: 'Descartable', grupo: 'Mercadería' },
  { nombre: 'Empleada', grupo: 'Fijos' },
  { nombre: 'Sueldo Popi', grupo: 'Fijos' },
  { nombre: 'Monotributo', grupo: 'Fijos' },
  { nombre: 'Varios', grupo: 'Otros' }
];
const GRUPOS_GASTO = ['Mercadería', 'Fijos', 'Otros'];
const MEDIOS_PAGO = ['Transferencia', 'Efectivo', 'Otro'];
const ESTADOS_PAGO = ['pagado', 'pendiente'];
const TIPOS_PRODUCTO = ['propio', 'reventa'];
const TIPOS_CLIENTE = ['Particular', 'Mayorista'];

function uid() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
}

// Validadores chicos: devuelven el valor limpio o tiran ApiError(400).
function reqDate(v, campo = 'fecha') {
  if (!isDate(v)) throw new ApiError(400, `La ${campo} no es válida.`);
  return v;
}
function reqText(v, campo, max = 120) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new ApiError(400, `Falta ${campo}.`);
  if (s.length > max) throw new ApiError(400, `${campo} es demasiado largo.`);
  return s;
}
function optText(v, max = 500) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : null;
}
function reqNum(v, campo, { min = 0, allowZero = false, allowNegative = false } = {}) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw new ApiError(400, `${campo} tiene que ser un número.`);
  if (!allowNegative && n < min) throw new ApiError(400, `${campo} no puede ser negativo.`);
  if (!allowZero && n === 0) throw new ApiError(400, `${campo} no puede ser cero.`);
  return Math.round(n * 10000) / 10000;
}
function optNum(v, campo) {
  if (v === '' || v === null || v === undefined) return null;
  return reqNum(v, campo, { allowZero: true });
}
function oneOf(v, list, campo) {
  if (!list.includes(v)) throw new ApiError(400, `${campo} no es válido.`);
  return v;
}

// Clave para comparar nombres escritos a mano ("Empanada  de QyC" = "empanada de qyc").
function normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

module.exports = {
  uid, ApiError, isDate, reqDate, reqText, optText, reqNum, optNum, oneOf, normName,
  DEFAULT_CATEGORIAS_GASTO, GRUPOS_GASTO, MEDIOS_PAGO, ESTADOS_PAGO, TIPOS_PRODUCTO, TIPOS_CLIENTE
};
