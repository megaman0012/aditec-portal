// Portal ADITEC - servidor HTTP nativo (sin frameworks).
// La web lee SOLO de la caché; nunca dispara consultas a MBA3.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, validar, describe } from './config.js';
import { crearSincronizador } from './sync/scheduler.js';

const VERSION = '0.1.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}

export function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), MIME['.json']);
}

async function serveStatic(req, res, pathname) {
  const root = path.resolve(config.publicDir);
  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return send(res, 400, 'Solicitud inválida');
  }
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, 'Prohibido');
  try {
    const data = await fs.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const cache = file.includes(`${path.sep}vendor${path.sep}`) ? { 'Cache-Control': 'public, max-age=86400' } : {};
    send(res, 200, req.method === 'HEAD' ? undefined : data, type, cache);
  } catch {
    send(res, 404, 'No encontrado');
  }
}

// Rutas /api/* se registran en Fase 5 (auth + tablero).
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/health') {
      return sendJson(res, 200, { ok: true, servicio: 'aditec-portal', version: VERSION, hora: new Date().toISOString() });
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'no implementado' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido', undefined, { Allow: 'GET, HEAD' });
    return await serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[http] error:', err.message);
    if (!res.headersSent) send(res, 500, 'Error interno');
  }
});

const { errores, avisos } = validar(config);
for (const a of avisos) console.warn('[config] AVISO:', a);
if (errores.length) {
  for (const e of errores) console.error('[config] ERROR:', e);
  process.exit(1);
}

// Sincronizador: corre en segundo plano, independiente de las peticiones web.
const sincronizador = crearSincronizador(config);

server.listen(config.port, () => {
  console.log(`[aditec-portal] v${VERSION} escuchando en :${config.port}`);
  console.log('[aditec-portal] config:', JSON.stringify(describe(config)));
  sincronizador.iniciar();
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[aditec-portal] ${sig} recibido, cerrando...`);
    sincronizador.detener();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
