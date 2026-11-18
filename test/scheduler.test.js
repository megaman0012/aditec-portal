process.env.NODE_ENV = 'test';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { iniciarMock } from './mock-mba3.js';
import { Mba3Client } from '../src/mba3/client.js';
import { crearSincronizador, planDePasada, hoyEn, reanudar } from '../src/sync/scheduler.js';
import { crearRepo } from '../src/data/repo.js';

const silencio = { log() {}, warn() {}, error() {} };

test('planDePasada: mes en curso primero y luego faltantes del más reciente al más antiguo', () => {
  const existe = (m) => m === '2026-08';
  assert.deepEqual(planDePasada({ historiaDesde: '2026-06-15', hoy: '2026-11-05', existe }), ['2026-11', '2026-10', '2026-09', '2026-07', '2026-06']);
});

test('hoyEn usa la zona horaria del negocio', () => {
  assert.equal(hoyEn('America/Guayaquil', new Date('2026-11-18T03:00:00Z')), '2026-11-17');
});

function cfgPrueba(base, dataDir) {
  return {
    tz: 'America/Guayaquil', dataDir,
    mba3: { base, codigo: 'test', pwd: 'test', empresa: 'ADITE', pausaMs: 60, renovarMs: 60_000, limit: 100 },
    sync: { activo: true, mesActualMin: 30, historiaDesde: '2026-10-01' },
    gastos: { confirmado: false, nomina_prefijos: ['6111'], generales_prefijos: ['6112'] },
    vendedores: [], reglas: {},
  };
}
const crearCliente = (o) => new Mba3Client({ ...o, pausaMs: 60, permitirPausaCorta: true });

const TABLAS = {
  CLNT_Factura_Principal: [
    { EMPRESA: 'ADITE', TIPO_DOCUMENTO: 'FACT', FECHA_FACTURA: '2026-10-03', VENDEDOR: 'A', ORIGEN: 'PRI', ANULADA: false, SUBTOTAL_CON_IVA: 100, SUBTOTAL_SIN_IVA: 0, VALOR_TOTAL_DESCUENTO: 0, TOTAL_DEVOLUCION: 0, VALOR_FACTURA: 115 },
  ],
  INVT_Producto_Movimientos: [
    { CORP: 'ADITE', ADJUSTMENT_TYPE: 'FT', TRANS_DATE: '2026-10-03', COD_SALESMAN: 'A', Anulada: false, QUANTITY: 2, TOT_RETURN_UNIT: 0, TRANS_COST: 20 },
  ],
  CONT_Asiento_Detalle: [
    { CORP: 'ADITE', GL_ACCOUNT_CODE: '61120006100', GL_MAIN_CODE_ONLY: '61120006', POST_TO_DATE: '2026-10-31', DEBIT_AMOUNT: 10, CREDIT_AMOUNT: 0, DEPARTMENT_CODE: '1', PROFIT_CENTER_CODE: '02' },
  ],
};

test('pasada por mes: escribe data/cache/AAAA-MM.json agregado + estado.json; el repo lo lee', async () => {
  const mock = await iniciarMock({ pausaMinMs: 50, tablas: TABLAS });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  try {
    const cfg = cfgPrueba(mock.url, dir);
    const s = crearSincronizador(cfg, { log: silencio, crearCliente });
    const r = await s.pasada({ meses: ['2026-10'] });
    assert.equal(r.errores, 0);
    assert.equal(r.peticiones, 4); // login + 3 tablas
    const mes = JSON.parse(fs.readFileSync(path.join(dir, 'cache/2026-10.json'), 'utf8'));
    assert.equal(mes.cerrado, true);
    assert.equal(mes.filas.length, 1);
    assert.equal(mes.filas[0].costo, 40);
    assert.equal(mes.pool.length, 1);
    assert.ok(!JSON.stringify(mes).includes('VALOR_FACTURA')); // sin filas crudas
    const est = JSON.parse(fs.readFileSync(path.join(dir, 'estado.json'), 'utf8'));
    assert.equal(est.estado, 'ok');
    assert.equal(est.meses['2026-10'].peticiones, 4);
    assert.equal(fs.existsSync(path.join(dir, 'mba3.lock')), false);
    assert.equal(mock.vetado, false);

    const res = crearRepo(cfg).resumen({ desde: '2026-10-01', hasta: '2026-10-31' });
    assert.equal(res.totalNacional.vn, 100);
    assert.equal(res.totalNacional.cv, 40);
    assert.equal(res.gastosPendientes, true);
    assert.deepEqual(res.cobertura.presentes, ['2026-10']);
    assert.deepEqual(res.comparativo.cobertura.faltantes, ['2025-10']);
  } finally { await mock.cerrar(); }
});

test('si una tabla falla, el mes anterior en caché se conserva', async () => {
  const mock = await iniciarMock({ pausaMinMs: 50, tablas: { CLNT_Factura_Principal: [] } }); // movimientos -> XML error
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  try {
    fs.mkdirSync(path.join(dir, 'cache'));
    fs.writeFileSync(path.join(dir, 'cache/2026-10.json'), '{"previo":true}');
    const s = crearSincronizador(cfgPrueba(mock.url, dir), { log: silencio, crearCliente });
    const r = await s.pasada({ meses: ['2026-10'] });
    assert.equal(r.errores, 1);
    assert.equal(fs.readFileSync(path.join(dir, 'cache/2026-10.json'), 'utf8'), '{"previo":true}');
  } finally { await mock.cerrar(); }
});

test('respuestas raras repetidas detienen el sincronizador y persisten la detención', async () => {
  const mock = await iniciarMock({ pausaMinMs: 50, tablas: {} }); // toda consulta -> XML de error
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  try {
    const s = crearSincronizador(cfgPrueba(mock.url, dir), { log: silencio, crearCliente });
    const r = await s.pasada({ meses: ['2026-10', '2026-09', '2026-08'] });
    assert.equal(r.detenido, true);
    assert.ok(fs.existsSync(path.join(dir, 'SYNC_DETENIDO.json')));
    const peticiones = mock.peticiones.length;
    assert.equal(peticiones, 4); // login + 3 consultas fallidas (una por mes), luego se para

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
