// Cliente MBA3 contra el simulador. NODE_ENV=test permite pausas cortas SOLO aquí.
process.env.NODE_ENV = 'test';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { iniciarMock } from './mock-mba3.js';
import { Mba3Client, interpretarRespuesta } from '../src/mba3/client.js';
import { consultarRango } from '../src/mba3/queries.js';

const PAUSA = 120;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mba3-'));
const filasFact = (n, fecha = '2026-10-05') =>
  Array.from({ length: n }, (_, i) => ({ EMPRESA: 'ADITE', TIPO_DOCUMENTO: 'FACT', FECHA_FACTURA: fecha, VENDEDOR: `V${i % 3}` }));

function nuevo(mock, extra = {}) {
  return new Mba3Client({
    base: mock.url, codigo: 'test', pwd: 'test', pausaMs: PAUSA, permitirPausaCorta: true, dataDir: tmp(), ...extra,
  });
}

test('interpretarRespuesta: filas, 009, XML, Unauthorized, rara', () => {
  assert.deepEqual(interpretarRespuesta(200, '[{"a":1}]'), { tipo: 'filas', filas: [{ a: 1 }] });
  assert.equal(interpretarRespuesta(200, '{"error":"009","respuesta":"No existen registros"}').vacio, true);
  assert.equal(interpretarRespuesta(200, '<x><contents>Campo no existe</contents></x>').mensaje, 'Campo no existe');
  assert.equal(interpretarRespuesta(401, 'Unauthorized').tipo, 'unauthorized');
  assert.equal(interpretarRespuesta(200, 'OK').tipo, 'rara');
});

test('fuera de NODE_ENV=test la pausa nunca baja de 1500 ms', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const c = new Mba3Client({ base: 'http://x', codigo: 'a', pwd: 'b', pausaMs: 10, permitirPausaCorta: true });
  process.env.NODE_ENV = prev;
  assert.equal(c.pausaMs, 1500);
});

test('las credenciales y el jwt no aparecen al serializar el cliente', () => {
  const c = new Mba3Client({ base: 'http://x', codigo: 'cod-secreto', pwd: 'pwd-secreta' });
  c._jwt = 'jwt-secreto';
  const s = JSON.stringify(c) + String(Object.keys(c));
  for (const x of ['cod-secreto', 'pwd-secreta', 'jwt-secreto']) assert.ok(!s.includes(x));
});

test('llamadas concurrentes se serializan y respetan la pausa (sin veto)', async () => {
  const mock = await iniciarMock({ pausaMinMs: PAUSA - 10, tablas: { CLNT_Factura_Principal: filasFact(5) } });
  try {
    const c = nuevo(mock);
    // A propósito disparamos 4 consultas a la vez: el cliente debe ponerlas en fila.
    const rs = await Promise.all([1, 2, 3, 4].map(() => c.consultar({ select: '*', from: 'CLNT_Factura_Principal', where: "EMPRESA = 'ADITE'", limit: 10 })));
    assert.ok(rs.every((r) => r.length === 5));
    assert.equal(mock.vetado, false);
    assert.equal(mock.peticiones.length, 5); // 1 login + 4 consultas
    const t = mock.peticiones.map((p) => p.t);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= PAUSA - 10, `separación ${t[i] - t[i - 1]} ms`);
  } finally {
    await mock.cerrar();
  }
});

test('009 devuelve arreglo vacío y no cuenta como rara', async () => {
  const mock = await iniciarMock({ pausaMinMs: 50, tablas: { T: [] } });
  try {
    const c = nuevo(mock);
    assert.deepEqual(await c.consultar({ select: '*', from: 'T', where: '' }), []);
    assert.equal(c.rarasSeguidas, 0);
  } finally { await mock.cerrar(); }
});

test('Unauthorized: renueva sesión y reintenta UNA vez', async () => {
  const mock = await iniciarMock({ pausaMinMs: 50, tablas: { T: [{ a: 1 }] } });
  try {
    const c = nuevo(mock);
    await c.consultar({ select: '*', from: 'T' });
    mock.expirarJwts();
    assert.deepEqual(await c.consultar({ select: '*', from: 'T' }), [{ a: 1 }]);
    const rutas = mock.peticiones.map((p) => p.ruta.includes('login') ? 'L' : 'Q').join('');
    assert.equal(rutas, 'LQQLQ');
  } finally { await mock.cerrar(); }
});

test('renueva el JWT de forma preventiva al pasar renovarMs', async () => {
  const mock = await iniciarMock({ pausaMinMs: 50, tablas: { T: [{ a: 1 }] } });
  try {
    const c = nuevo(mock, { renovarMs: 200 });
    await c.consultar({ select: '*', from: 'T' });
    await new Promise((r) => setTimeout(r, 250));
    await c.consultar({ select: '*', from: 'T' });
    assert.equal(mock.peticiones.filter((p) => p.ruta.includes('login')).length, 2);
  } finally { await mock.cerrar(); }
});

test('XML de error lanza excepción; 3 seguidas detienen el cliente', async () => {
  const mock = await iniciarMock({ pausaMinMs: 50, tablas: {} });
  try {
    const c = nuevo(mock);
    for (let i = 1; i <= 3; i++) {
      await assert.rejects(c.consultar({ select: '*', from: 'NO_EXISTE' }), (e) => e.tipo === 'xml');
    }
    assert.equal(c.detenido, true);
    const antes = mock.peticiones.length;
    await assert.rejects(c.consultar({ select: '*', from: 'NO_EXISTE' }), (e) => e.tipo === 'detenido');
    assert.equal(mock.peticiones.length, antes, 'detenido: no debe enviar más peticiones');
  } finally { await mock.cerrar(); }
});

test('error 003 "IP No Autorizada" detiene el cliente a la primera', async () => {
  const http = await import('node:http');
  let n = 0;
  const srv = http.createServer((req, res) => {
    n++;
    req.resume();
    res.end('{"error":"003","respuesta":"IP No Autorizada"}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const c = new Mba3Client({ base: `http://127.0.0.1:${srv.address().port}`, codigo: 'a', pwd: 'b', pausaMs: 50, permitirPausaCorta: true, dataDir: tmp() });
    await assert.rejects(c.consultar({ select: '*', from: 'T' }), (e) => e.tipo === 'ip-bloqueada');
    assert.equal(c.detenido, true);
    await assert.rejects(c.consultar({ select: '*', from: 'T' }), (e) => e.tipo === 'detenido');
    assert.equal(n, 1, 'solo una petición: no insiste');
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('una respuesta buena reinicia el contador de raras', async () => {
  const mock = await iniciarMock({ pausaMinMs: 50, tablas: { T: [{ a: 1 }] } });
  try {
    const c = nuevo(mock);
    await assert.rejects(c.consultar({ select: '*', from: 'X' }));
    await assert.rejects(c.consultar({ select: '*', from: 'X' }));
    await c.consultar({ select: '*', from: 'T' });
    assert.equal(c.rarasSeguidas, 0);
    assert.equal(c.detenido, false);
  } finally { await mock.cerrar(); }
});

test('rechaza API de escritura y filtros ORDA inválidos sin enviar nada', async () => {
  const mock = await iniciarMock({ pausaMinMs: 50 });
  try {
    const c = nuevo(mock);
    await assert.rejects(c._peticion('/ws2_mba3_serv_api_/x', { method: 'POST' }), /escritura/);
    await assert.rejects(c.consultar({ select: '*', from: 'T', where: "A <> 'x'" }), /ORDA/);
    await assert.rejects(c.consultar({ select: '*', from: 'T', where: "F = {d '2026-01-01'}" }), /ORDA/);
    assert.equal(mock.peticiones.length, 0);
  } finally { await mock.cerrar(); }
});

test('lock: un segundo proceso no puede tomar MBA3 mientras otro lo usa', () => {
  const dir = tmp();
  const a = new Mba3Client({ base: 'http://x', codigo: 'a', pwd: 'b', dataDir: dir });
  const b = new Mba3Client({ base: 'http://x', codigo: 'a', pwd: 'b', dataDir: dir });
  a.tomarLock('A');
  // Simula otro proceso vivo en el mismo host (pid 1 siempre existe)
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'mba3.lock'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'mba3.lock'), JSON.stringify({ ...lock, pid: 1 }));
  assert.throws(() => b.tomarLock('B'), (e) => e.tipo === 'lock');
  // Lock huérfano (pid inexistente) se reemplaza
  fs.writeFileSync(path.join(dir, 'mba3.lock'), JSON.stringify({ ...lock, pid: 999999 }));
  b.tomarLock('B');
  assert.equal(b.lockTomado, true);
});

test('consultarRango parte el rango cuando llega al límite', async () => {
  const tabla = [
    ...filasFact(3, '2026-10-02'),
    ...filasFact(3, '2026-10-20'),
  ];
  const mock = await iniciarMock({ pausaMinMs: 50, tablas: { CLNT_Factura_Principal: tabla } });
  try {
    const c = nuevo(mock);
    const partes = [];
    const filas = await consultarRango(c, {
      tabla: 'facturas', empresa: 'ADITE', desde: '2026-10-01', hasta: '2026-10-31', limit: 4,
      alPartir: (p) => partes.push(p),
    });
    assert.equal(filas.length, 6);
    assert.ok(partes.length >= 1);
    assert.equal(mock.vetado, false);
  } finally { await mock.cerrar(); }
});
