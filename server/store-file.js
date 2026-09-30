// Backend de desarrollo: todo el estado en un JSON local (data/kasa.json).
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'kasa.json');
// Para probar la importación en local: las pestañas viejas exportadas con
// scripts/exportar-planilla-vieja.py, con la misma forma que devuelve la API de Sheets.
const RAW_FILE = path.join(DATA_DIR, 'planilla-vieja.json');

async function load() {
  if (!fs.existsSync(FILE)) return {};
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

async function save(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // Escritura atómica: si se corta a mitad de camino no deja el archivo roto.
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

async function readRaw(titles) {
  const raw = fs.existsSync(RAW_FILE) ? JSON.parse(fs.readFileSync(RAW_FILE, 'utf8')) : {};
  const out = {};
  titles.forEach(t => { out[t] = raw[t] || null; });
  return out;
}

module.exports = { load, save, readRaw, name: 'archivo local (data/kasa.json)' };
