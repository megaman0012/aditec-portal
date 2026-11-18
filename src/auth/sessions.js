// Sesiones con cookie firmada (HMAC-SHA256 con SESSION_SECRET).
// Valor: base64url(JSON {u, iat, exp, jti}) + "." + base64url(HMAC).
// El rol NO viaja en la cookie: se lee de usuarios.json en cada petición (cambios de rol o
// usuarios borrados surten efecto de inmediato). Logout revoca el jti hasta su expiración.
import crypto from 'node:crypto';

export const COOKIE = 'aditec_sid';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function crearSesiones({ secret, horas, secure = false }) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET inválido');
  const revocados = new Map(); // jti -> exp
  const firmar = (data) => b64u(crypto.createHmac('sha256', secret).update(data).digest());

  function emitir(usuario) {
    const ahora = Date.now();
    const payload = b64u(JSON.stringify({ u: usuario, iat: ahora, exp: ahora + horas * 3_600_000, jti: crypto.randomBytes(12).toString('hex') }));
    return `${payload}.${firmar(payload)}`;
  }

  function verificar(valor) {
    if (typeof valor !== 'string' || valor.length > 1024) return null;
    const [payload, firma] = valor.split('.');
    if (!payload || !firma) return null;
    const esperada = Buffer.from(firmar(payload));
    const recibida = Buffer.from(firma);
    if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
    let s;
    try { s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
    if (!s?.u || !Number.isFinite(s.exp) || s.exp <= Date.now() || revocados.has(s.jti)) return null;
    return s;
  }

  function revocar(s) {
    if (s?.jti) revocados.set(s.jti, s.exp);
    const ahora = Date.now();
    for (const [j, exp] of revocados) if (exp <= ahora) revocados.delete(j);
  }

  function cookie(valor, maxAgeSeg) {
    return [
      `${COOKIE}=${valor}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeg}`, secure ? 'Secure' : null,
    ].filter(Boolean).join('; ');
  }

  return {
    emitir,
    verificar,
    revocar,
    cookieLogin: (valor) => cookie(valor, Math.floor(horas * 3600)),
    cookieLogout: () => cookie('', 0),
  };
}

export function leerCookies(req) {
  const out = {};
  for (const parte of String(req.headers.cookie ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) out[parte.slice(0, i).trim()] = parte.slice(i + 1).trim();
  }
  return out;
}
