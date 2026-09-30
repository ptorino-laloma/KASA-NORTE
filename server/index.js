// Servidor local para desarrollo: sirve public/ y delega /api/* en app.js.
// En Vercel no se usa este archivo (ver api/handler.js y vercel.json).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile() {
  // Cargador de .env mínimo, sin depender de dotenv.
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
loadEnvFile();

const app = require('./app.js');
const store = require('./store.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png'
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC_DIR, filePath);
  fs.readFile(full, (err, content) => {
    if (err) {
      // SPA fallback: cualquier ruta que no sea archivo ni /api sirve index.html
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, indexContent) => {
        if (err2) { res.writeHead(404); res.end('No encontrado'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(indexContent);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) return app.handle(req, res, pathname);
  if (req.method === 'GET') return serveStatic(req, res, pathname);
  res.writeHead(405); res.end('Método no permitido');
});

server.listen(PORT, () => {
  console.log(`Kasa Norte corriendo en http://localhost:${PORT}`);
  console.log(`Datos: ${store.backendName}`);
});
