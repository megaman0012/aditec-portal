// API de punta a punta: servidor real en puerto aleatorio, caché y usuarios temporales.
process.env.NODE_ENV = 'test';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import { crearRateLimit } from '../src/auth/ratelimit.js';
import { crearSesiones } from '../src/auth/sessions.js';

const silencio = { log() {}, warn() {}, error() {} };
const CLAVE = 'clave-de-prueba-123';
let base, server, cfg, recargas;

before(async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-'));
  fs.writeFileSync(path.join(configDir, 'usuarios.json'), JSON.stringify({
    usuarios: [
      { usuario: 'admin1', nombre: 'Admin Prueba', rol: 'admin', ...(await hashPassword(CLAVE)) },
      { usuario: 'gerente', nombre: 'Gerencia Prueba', rol: 'gerencia', ...(await hashPassword(CLAVE)) },
    ],
  }));
  fs.mkdirSync(path.join(dataDir, 'cache'));
  fs.writeFileSync(path.join(dataDir, 'cache', '2026-10.json'), JSON.stringify({
    mes: '2026-10', generado: '2026-11-18T12:00:00.000Z',
    filas: [
      { fecha: '2026-10-02', vendedor: 'A01', sucursal: 'PRI', sub: 900, desc: 100, descAnomalo: 0, dev: 0, costo: 400, nFacturas: 2 },
      { fecha: '2026-10-05', vendedor: 'B02', sucursal: 'UIO', sub: 300, desc: 50, descAnomalo: 0, dev: 50, costo: 100, nFacturas: 1 },
    ],
    pool: [],
  }));
  recargas = [];
  cfg = {
    tz: 'America/Guayaquil', configDir, dataDir, publicDir: new URL('../public/', import.meta.url).pathname,
    session: { secret: 'x'.repeat(64), horas: 8, secure: false },
    sync: { historiaDesde: '2025-01-01' },
    gastos: { confirmado: false },
    vendedores: [{ codigo: 'A01', alias: 'AUNO', sucursal: 'Guayaquil', area: 'Comercial' }, { codigo: 'B02', alias: 'BDOS', area: 'Técnica' }],
    umbrales: undefined, reglas: {},
  };
  const sync = { recargarMes: (mes) => { recargas.push(mes); return { encolado: mes, posicion: 1 }; }, estado: () => ({ estado: 'ok' }) };
  server = crearApp(cfg, { sync, log: silencio, rateLimit: crearRateLimit({ maxFallos: 5 }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const login = (usuario, password, extra = {}) =>
  fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ usuario, password }) });
async function cookieDe(usuario) {
  const r = await login(usuario, CLAVE);
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
const get = (p, cookie) => fetch(base + p, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });

test('health, cabeceras de seguridad y redirección sin sesión', async () => {
  const h = await get('/health');
  assert.equal(h.status, 200);
  const r = await get('/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login.html');
  const l = await get('/login.html');
  assert.equal(l.status, 200);
  assert.match(l.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(l.headers.get('content-security-policy'), /unsafe-inline/);
  assert.equal(l.headers.get('x-frame-options'), 'DENY');
  assert.equal(l.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(l.headers.get('referrer-policy'), 'no-referrer');
});

test('API sin sesión -> 401', async () => {
  for (const p of ['/api/me', '/api/filtros', '/api/tablero', '/api/tablero.csv', '/api/estado']) {
    assert.equal((await get(p)).status, 401, p);
  }
});

test('login: cookie HttpOnly + SameSite=Strict firmada; /api/me', async () => {
  const r = await login('ADMIN1', CLAVE); // usuario sin distinguir mayúsculas
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /^aditec_sid=[^;]+\.[^;]+;/);
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  assert.match(sc, /Max-Age=28800/);
  assert.doesNotMatch(sc, /Secure/);
  const me = await (await get('/api/me', sc.split(';')[0])).json();
  assert.equal(me.usuario, 'admin1');
  assert.equal(me.rol, 'admin');
  assert.ok(!JSON.stringify(me).includes('hash'));
});

test('cookie manipulada o de otro secreto -> 401', async () => {
  const c = await cookieDe('gerente');
  const [payload, firma] = c.split('=')[1].split('.');
  const otro = Buffer.from(JSON.stringify({ u: 'admin1', iat: Date.now(), exp: Date.now() + 1e6, jti: 'x' })).toString('base64url');
  assert.equal((await get('/api/me', `aditec_sid=${otro}.${firma}`)).status, 401);
  const ajena = crearSesiones({ secret: 'y'.repeat(64), horas: 8 }).emitir('admin1');
  assert.equal((await get('/api/me', `aditec_sid=${ajena}`)).status, 401);
  assert.equal((await get('/api/me', `aditec_sid=${payload}.${firma}`)).status, 200);
});

test('logout revoca la sesión', async () => {
  const c = await cookieDe('gerente');
  const r = await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: c } });
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await get('/api/me', c)).status, 401);
});

test('tablero: cifras, filtros, porSucursal, meta y comparativo', async () => {
  const c = await cookieDe('gerente');
  const t = await (await get('/api/tablero?desde=2026-10-01&hasta=2026-10-31', c)).json();
  assert.equal(t.nacional.vn, 1150);
  assert.deepEqual(t.asesores.map((a) => a.asesor), ['A01', 'B02']);
  assert.equal(t.asesores[0].alias, 'AUNO');
  assert.equal(t.meta.pendientes.gastos, 'Pendiente de configurar');
  assert.equal(t.meta.actualizado, '2026-11-18T12:00:00.000Z');
  assert.deepEqual(t.meta.pendientes.mesesSinDatos, []);
  assert.deepEqual(t.porSucursal.map((s) => s.sucursal).sort(), ['Guayaquil', 'UIO']);
  assert.equal(t.comparativo.desde, '2025-10-01');
  assert.equal(t.asesores[0].gt, null);

  const f = await (await get('/api/tablero?desde=2026-10-01&hasta=2026-10-31&area=T%C3%A9cnica', c)).json();
  assert.deepEqual(f.asesores.map((a) => a.asesor), ['B02']);
  assert.equal(f.nacional.vn, 1150);
  const v = await (await get('/api/tablero?desde=2026-10-01&hasta=2026-10-31&vendedores=A01', c)).json();
  assert.deepEqual(v.asesores.map((a) => a.asesor), ['A01']);
});

test('validación de parámetros', async () => {
  const c = await cookieDe('gerente');
  for (const q of ['desde=2026-02-30&hasta=2026-03-01', 'desde=2026-10-31&hasta=2026-10-01', 'desde=2024-01-01&hasta=2026-10-31', 'desde=hoy&hasta=2026-10-31', 'desde=2026-10-01&hasta=2026-10-31&vendedores=a%22b']) {
    const r = await get(`/api/tablero?${q}`, c);
    assert.equal(r.status, 400, q);
  }
  assert.equal((await get('/api/tablero?desde=2025-01-01&hasta=2026-12-31', c)).status, 200); // 24 meses justos
});

test('filtros disponibles', async () => {
  const c = await cookieDe('gerente');
  const f = await (await get('/api/filtros', c)).json();
  assert.deepEqual(f.meses, ['2026-10']);
  assert.equal(f.rango.desde, '2026-10-01');
  assert.equal(f.rango.hasta, '2026-10-31');
  assert.ok(f.sucursales.includes('Guayaquil') && f.sucursales.includes('UIO'));
  assert.deepEqual(f.areas, ['Comercial', 'Técnica']);
  assert.equal(f.vendedores.find((v) => v.codigo === 'B02').sucursal, 'UIO');
});

test('CSV: BOM, separador ";", coma decimal, gastos pendientes', async () => {
  const c = await cookieDe('gerente');
  const r = await get('/api/tablero.csv?desde=2026-10-01&hasta=2026-10-31', c);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /rentabilidad_2026-10-01_2026-10-31\.csv/);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // BOM UTF-8 para Excel
  const txt = bytes.toString('utf8');
  const lineas = txt.trim().split('\r\n');
  assert.match(lineas[1], /^Código;Alias;/);
  assert.match(lineas[2], /^A01;AUNO;;Guayaquil;Comercial;2;1000;100;900;400;500;Pendiente de configurar/);
  assert.match(lineas.at(-1), /^TOTAL NACIONAL;/);
});

test('admin: estado y recargar (solo admin; encola sin bloquear)', async () => {
  const g = await cookieDe('gerente');
  const a = await cookieDe('admin1');
  assert.equal((await get('/api/estado', g)).status, 403);
  assert.equal((await get('/api/estado', a)).status, 200);
  const post = (p, c, extra = {}) => fetch(base + p, { method: 'POST', headers: { Cookie: c, ...extra } });
  assert.equal((await post('/api/admin/recargar?mes=2026-10', g)).status, 403);
  assert.equal((await post('/api/admin/recargar?mes=2026-13', a)).status, 400);
  assert.equal((await post('/api/admin/recargar?mes=2020-01', a)).status, 400);
  assert.equal((await post('/api/admin/recargar?mes=2026-10', a, { Origin: 'http://evil.example' })).status, 403);
  const r = await post('/api/admin/recargar?mes=2026-10', a);
  assert.equal(r.status, 202);
  assert.deepEqual(recargas, ['2026-10']);
});

test('rate limit: 5 fallos -> 429 con Retry-After, incluso con la clave correcta', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login('gerente', 'mala-clave-xx')).status, 401);
  const r = await login('gerente', CLAVE);
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 800);
});

test('rate limit (unidad): ventana de 15 min y bloqueo de 15 min', () => {
  let t = 0;
  const rl = crearRateLimit({ ahora: () => t });
  for (let i = 0; i < 4; i++) rl.fallo('1.2.3.4');
  t += 16 * 60_000; // fallos viejos salen de la ventana
  rl.fallo('1.2.3.4');
  assert.equal(rl.bloqueado('1.2.3.4'), 0);
  for (let i = 0; i < 4; i++) rl.fallo('1.2.3.4');
  assert.ok(rl.bloqueado('1.2.3.4') > 0);
  t += 15 * 60_000;
  assert.equal(rl.bloqueado('1.2.3.4'), 0);
});
