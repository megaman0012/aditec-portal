// Utilidades HTTP nativas: respuestas, cabeceras de seguridad, cuerpo y validación de parámetros.

export const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  // Cross-Origin-Opener-Policy se omite: Chrome la ignora (con error en consola) fuera de HTTPS.
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store',
};

export function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}

export function sendJson(res, status, obj, extra = {}) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', extra);
}

export class HttpError extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

// Lee el cuerpo (JSON o x-www-form-urlencoded), máx. 8 KB.
export function leerCuerpo(req, max = 8192) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > max) { reject(new HttpError(413, 'Cuerpo demasiado grande')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      const txt = Buffer.concat(partes).toString('utf8');
      const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim();
      try {
        if (tipo === 'application/json') return resolve(txt ? JSON.parse(txt) : {});
        if (tipo === 'application/x-www-form-urlencoded') return resolve(Object.fromEntries(new URLSearchParams(txt)));
        return resolve({});
      } catch {
        reject(new HttpError(400, 'JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

// --- Validación de parámetros ---
export function fechaValida(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f ?? '')) return false;
  const [y, m, d] = f.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function mesValido(m) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? '');
}

const CODIGO = /^[\p{L}\p{N}._ -]{1,40}$/u; // letras con tilde permitidas (Técnica)
export function lista(valor, { max = 50, nombre = 'parámetro' } = {}) {
  if (valor == null || valor === '') return [];
  const items = String(valor).split(',').map((s) => s.trim()).filter(Boolean);
  if (items.length > max) throw new HttpError(400, `${nombre}: máximo ${max} valores`);
  for (const i of items) if (!CODIGO.test(i)) throw new HttpError(400, `${nombre}: valor inválido`);
  return items;
}

export function ipDe(req) {
  return String(req.socket?.remoteAddress ?? '?').replace(/^::ffff:/, '');
}

// ¿La IPv4 `ip` pertenece a la red `cidr` (p. ej. "172.18.0.0/16")?
export function ipEnRed(ip, cidr) {
  const aNum = (x) => x.split('.').reduce((n, o) => (n << 8) + (Number(o) & 255), 0) >>> 0;
  const [red, bits = '32'] = String(cidr).split('/');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(red)) return false;
  const b = Number(bits);
  const mascara = b === 0 ? 0 : (~0 << (32 - b)) >>> 0;
  return (aNum(ip) & mascara) === (aNum(red) & mascara);
}

// IP del cliente. Detrás del proxy (TRUST_PROXY=true) usa la ÚLTIMA entrada de X-Forwarded-For,
// solo si la conexión viene de una red de proxy de confianza (TRUSTED_PROXY_IPS).
export function crearIpDe({ confiar = false, redes = [] } = {}) {
  return (req) => {
    const directa = ipDe(req);
    if (!confiar || !redes.some((r) => ipEnRed(directa, r))) return directa;
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return xff.length ? xff[xff.length - 1].replace(/^::ffff:/, '') : directa;
  };
}
