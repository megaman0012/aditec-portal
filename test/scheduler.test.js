process.env.NODE_ENV = 'test';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { iniciarMock } from './mock-mba3.js';
import { Mba3Client } from '../src/mba3/client.js';
import { crearSincronizador, mesesPendientes, hoyEn, reanudar } from '../src/sync/scheduler.js';

const silencio = { log() {}, warn() {}, error() {} };

test('mesesPendientes: historia faltante + mes actual + anterior hasta el día 10', () => {
  const existe = (m) => m !== '2026-08';
  assert.deepEqual(mesesPendientes({ historiaDesde: '2026-07-15', hoy: '2026-11-05', existe }), ['2026-08', '2026-10', '2026-11']);
  assert.deepEqual(mesesPendientes({ historiaDesde: '2026-07-15', hoy: '2026-11-17', existe }), ['2026-08', '2026-11']);
});

test('hoyEn usa la zona horaria del negocio', () => {
  // 2026-11-18 03:00 UTC = 2026-11-17 22:00 en Guayaquil (UTC-5)
  assert.equal(hoyEn('America/Guayaquil', new Date('2026-11-18T03:00:00Z')), '2026-11-17');
});

function cfgPrueba(base, dataDir) {
  return {
    tz: 'America/Guayaquil', dataDir,
    mba3: { base, codigo: 'test', pwd: 'test', empresa: 'ADITE', pausaMs: 60, renovarMs: 60_000, limit: 100 },
    sync: { activo: true, mesActualMin: 30, historiaDesde: '2026-10-01' },
    gastos: { nomina: [], generales: [] },
  };
}
const crearCliente = (o) => new Mba3Client({ ...o, pausaMs: 60, permitirPausaCorta: true });

test('pasada manual escribe caché por mes y estado', async () => {
  const mock = await iniciarMock({
    pausaMinMs: 50,
    tablas: {
      CLNT_Factura_Principal: [{ EMPRESA: 'ADITE', TIPO_DOCUMENTO: 'FACT', FECHA_FACTURA: '2026-10-03', VENDEDOR: 'A' }],
      INVT_Producto_Movimientos: [],
    },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  try {
    const s = crearSincronizador(cfgPrueba(mock.url, dir), { log: silencio, crearCliente });
    const r = await s.pasada({ desde: '2026-10-01', hasta: '2026-10-31' });
    assert.equal(r.errores, 0);
    const fact = JSON.parse(fs.readFileSync(path.join(dir, 'cache/facturas/2026-10.json'), 'utf8'));
    assert.equal(fact.filas.length, 1);
    const mov = JSON.parse(fs.readFileSync(path.join(dir, 'cache/movimientos/2026-10.json'), 'utf8'));
    assert.deepEqual(mov.filas, []); // 009 -> vacío, no error
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'estado-sync.json'), 'utf8')).estado, 'ok');
    assert.equal(fs.existsSync(path.join(dir, 'mba3.lock')), false, 'el lock se libera al terminar');
    assert.equal(mock.vetado, false);
  } finally { await mock.cerrar(); }
});

test('respuestas raras repetidas detienen el sincronizador y persisten la detención', async () => {
  const mock = await iniciarMock({ pausaMinMs: 50, tablas: {} }); // toda consulta -> XML de error
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  try {
    const s = crearSincronizador(cfgPrueba(mock.url, dir), { log: silencio, crearCliente });
    const r = await s.pasada({ desde: '2026-09-01', hasta: '2026-10-31' });
    assert.equal(r.detenido, true);
    assert.ok(fs.existsSync(path.join(dir, 'SYNC_DETENIDO.json')));
    const peticiones = mock.peticiones.length;
    assert.equal(peticiones, 4); // login + 3 consultas fallidas, luego se para

    // Un sincronizador nuevo (p.ej. tras reiniciar) NO vuelve a llamar a MBA3
    const s2 = crearSincronizador(cfgPrueba(mock.url, dir), { log: silencio, crearCliente });
    assert.equal(s2.iniciar(), false);
    assert.match((await s2.pasada()).omitida, /detenido/);
    assert.equal(mock.peticiones.length, peticiones);

    assert.equal(reanudar(dir), true);
    assert.equal(fs.existsSync(path.join(dir, 'SYNC_DETENIDO.json')), false);
  } finally { await mock.cerrar(); }
});

test('SYNC_ACTIVO=false: no inicia', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  const cfg = cfgPrueba('http://127.0.0.1:1', dir);
  cfg.sync.activo = false;
  assert.equal(crearSincronizador(cfg, { log: silencio }).iniciar(), false);
});
