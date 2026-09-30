// Función serverless de Vercel. vercel.json reescribe /api/<ruta> a
// /api/handler?__path=<ruta>; acá se reconstruye la ruta original y se delega en app.js.
const app = require('../server/app.js');

module.exports = (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const rest = u.searchParams.get('__path');
  const pathname = rest !== null ? '/api/' + rest.replace(/^\/+/, '') : u.pathname;
  return app.handle(req, res, pathname);
};
