// Contraseñas con crypto.scrypt (asíncrono, no bloquea el servidor).
// Se guarda { hash, salt } en hex; parámetros fijos N=16384, r=8, p=1, 64 bytes.
import crypto from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;
export const MIN_LONGITUD = 10;

function scrypt(plain, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(String(plain), salt, KEYLEN, PARAMS, (err, key) => (err ? reject(err) : resolve(key))));
}

// `minimo` solo se baja para claves TEMPORALES que el usuario debe cambiar al primer ingreso.
export async function hashPassword(plain, { minimo = MIN_LONGITUD } = {}) {
  if (typeof plain !== 'string' || plain.length < minimo) {
    throw new Error(`La contraseña debe tener al menos ${minimo} caracteres`);
  }
  const salt = crypto.randomBytes(16);
  const key = await scrypt(plain, salt);
  return { hash: key.toString('hex'), salt: salt.toString('hex') };
}

export async function verifyPassword(plain, { hash, salt } = {}) {
  try {
    if (!/^[0-9a-f]{128}$/.test(hash ?? '') || !/^[0-9a-f]{32}$/.test(salt ?? '')) return false;
    const key = await scrypt(plain, Buffer.from(salt, 'hex'));
    return crypto.timingSafeEqual(key, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

// Para usuarios inexistentes: gasta el mismo tiempo que una verificación real (evita enumerar usuarios).
const SALT_FALSO = crypto.randomBytes(16);
export async function verificacionFalsa(plain) {
  await scrypt(plain ?? '', SALT_FALSO);
  return false;
}
