// Hash de contraseñas con scrypt (node:crypto). Formato: scrypt$N$r$p$salt_b64$hash_b64
import crypto from 'node:crypto';

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(plain, stored) {
  try {
    const [alg, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const got = crypto.scryptSync(String(plain), Buffer.from(saltB64, 'base64'), expected.length, { N: +n, r: +r, p: +p });
    return crypto.timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}
