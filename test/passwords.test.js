import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';

test('scrypt: verifica correcta, rechaza incorrecta, no guarda texto plano', () => {
  const h = hashPassword('clave-de-prueba-123');
  assert.ok(h.startsWith('scrypt$') && !h.includes('clave-de-prueba-123'));
  assert.equal(verifyPassword('clave-de-prueba-123', h), true);
  assert.equal(verifyPassword('otra', h), false);
  assert.equal(verifyPassword('x', 'basura'), false);
});
