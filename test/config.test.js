import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarConfig, validar, describe } from '../src/config.js';

const base = { SESSION_SECRET: 'x'.repeat(64), CONFIG_DIR: '/nonexistent' };

test('MBA3_PAUSA_MS nunca baja de 1500 ms', () => {
  assert.equal(cargarConfig({ ...base, MBA3_PAUSA_MS: '200' }).mba3.pausaMs, 1500);
  assert.equal(cargarConfig({ ...base, MBA3_PAUSA_MS: '3000' }).mba3.pausaMs, 3000);
});

test('describe() no expone secretos', () => {
  const s = JSON.stringify(describe(cargarConfig({ ...base, MBA3_CODIGO: 'cod-secreto', MBA3_PWD: 'pwd-secreta' })));
  for (const x of ['cod-secreto', 'pwd-secreta', 'x'.repeat(64)]) assert.ok(!s.includes(x));
});

test('validar: sin SESSION_SECRET es error; sin credenciales MBA3 es solo aviso', () => {
  const v1 = validar(cargarConfig({ CONFIG_DIR: '/nonexistent' }));
  assert.ok(v1.errores.some((e) => e.includes('SESSION_SECRET')));
  const v2 = validar(cargarConfig(base));
  assert.equal(v2.errores.length, 0);
  assert.ok(v2.avisos.some((a) => a.includes('MBA3_CODIGO')));
});

test('validar: MBA3_RENOVAR_MIN debe ser < 10', () => {
  assert.ok(validar(cargarConfig({ ...base, MBA3_RENOVAR_MIN: '10' })).errores.length > 0);
});

test('config real del repo (vendedores.json y gastos.json) es válida', () => {
  const cfg = cargarConfig({ ...base, CONFIG_DIR: new URL('../config/', import.meta.url).pathname });
  const v = validar(cfg);
  assert.deepEqual(v.errores, []);
  assert.ok(cfg.vendedores.length > 0);
  if (cfg.gastos.confirmado !== true) assert.ok(v.avisos.some((a) => a.includes('Pendiente')));
});

test('gastos confirmado con department_code "?" es error', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.writeFileSync(path.join(dir, 'vendedores.json'), '[{"codigo":"A"}]');
  fs.writeFileSync(path.join(dir, 'gastos.json'), JSON.stringify({ confirmado: true, nomina_prefijos: ['6111'], generales_prefijos: [], asignacion: { A: { department_code: '?' } } }));
  const v = validar(cargarConfig({ ...base, CONFIG_DIR: dir }));
  assert.ok(v.errores.some((e) => e.includes('department_code')));
});
