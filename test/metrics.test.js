import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indicadores, calcular, div, semaforo, asignarGastos, clasificarCuenta, rangoAnioAnterior, UMBRALES_DEFECTO,
} from '../src/calc/metrics.js';

const cerca = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

const GASTOS_OK = {
  confirmado: true,
  nomina_prefijos: ['6111'],
  generales_prefijos: ['6112'],
  excluir_prefijos: ['61120200'],
  sin_asignar: 'prorratear_por_ventas_netas',
  asignacion: {},
};

test('div entre 0 devuelve null', () => {
  assert.equal(div(10, 0), null);
  assert.equal(div(0, 0), null);
  assert.equal(div(5, 2), 2.5);
});

test('EXCEL: columna de ejemplo reproduce VN, UB, GT, UN y RUN', () => {
  const i = indicadores({ vb: 293394.67, dd: 6328.61, cv: 139782.87, gn: 11553.42, gg: 3524.48 });
  cerca(i.vn, 287066.06);
  cerca(i.ub, 147283.19);
  cerca(i.gt, 15077.90);
  cerca(i.un, 132205.29);
  cerca(i.run * 100, 46.05);
});

test('EXCEL: la misma columna sale igual pasando por caché agregada + calcular()', () => {
  const datos = {
    filas: [{ fecha: '2026-10-15', vendedor: 'BO-FE', sucursal: 'PRI', sub: 293394.67, desc: 0, descAnomalo: 0, dev: 6328.61, costo: 139782.87, nFacturas: 10 }],
    pool: [
      { fecha: '2026-10-31', dep: '1', pc: '01', cuenta: '61110001', monto: 11553.42 },
      { fecha: '2026-10-31', dep: '1', pc: '02', cuenta: '61120006', monto: 3524.48 },
      { fecha: '2026-10-31', dep: '1', pc: '02', cuenta: '61120200', monto: 999 }, // excluida
    ],
  };
  const r = calcular(datos, { desde: '2026-10-01', hasta: '2026-10-31' }, { gastos: GASTOS_OK });
  const a = r.asesores[0];
  assert.equal(a.vb, 293394.67);
  assert.equal(a.dd, 6328.61);
  assert.equal(a.vn, 287066.06);
  assert.equal(a.ub, 147283.19);
  assert.equal(a.gt, 15077.9);
  assert.equal(a.un, 132205.29);
  cerca(a.run * 100, 46.05);
  assert.equal(a.part.vn, 1);
});

test('indicadores sin ventas -> porcentajes null', () => {
  const i = indicadores({ gn: 10, gg: 0 });
  assert.equal(i.vn, 0);
  assert.equal(i.run, null);
  assert.equal(i.pctD, null);
});

test('semáforo con umbrales mínimos y máximos', () => {
  const { rentabilidad: R, descuentos: D } = UMBRALES_DEFECTO;
  assert.equal(semaforo(0.2, R), 'verde');
  assert.equal(semaforo(0.1, R), 'amarillo');
  assert.equal(semaforo(-0.1, R), 'rojo');
  assert.equal(semaforo(0.02, D), 'verde');
  assert.equal(semaforo(0.05, D), 'amarillo');
  assert.equal(semaforo(0.2, D), 'rojo');
  assert.equal(semaforo(null, R), null);
});

test('clasificarCuenta respeta exclusiones', () => {
  assert.equal(clasificarCuenta('61110001', GASTOS_OK), 'nomina');
  assert.equal(clasificarCuenta('61120006', GASTOS_OK), 'general');
  assert.equal(clasificarCuenta('61120200', GASTOS_OK), null);
  assert.equal(clasificarCuenta('71110001', GASTOS_OK), null);
});

test('asignarGastos: por departamento/centro y resto prorrateado por VN', () => {
  const g = { ...GASTOS_OK, asignacion: { A: { department_code: '1', profit_center_code: '01' }, B: { department_code: '2', profit_center_code: '01' }, C: { department_code: '1', profit_center_code: '01' } } };
  const vn = { A: 300, B: 100, C: 100 };
  const pool = [
    { dep: '1', pc: '01', cuenta: '61110001', monto: 400 }, // A y C: 300/400 y 100/400
    { dep: '2', pc: '01', cuenta: '61120001', monto: 50 }, // solo B
    { dep: '1', pc: '02', cuenta: '61120001', monto: 1000 }, // nadie coincide -> todos por VN
  ];
  const { porAsesor, noAsignado } = asignarGastos(pool, vn, g);
  cerca(porAsesor.A.gn, 300);
  cerca(porAsesor.C.gn, 100);
  cerca(porAsesor.B.gn, 0);
  cerca(porAsesor.B.gg, 50 + 200);
  cerca(porAsesor.A.gg, 600);
  cerca(porAsesor.C.gg, 200);
  assert.deepEqual(noAsignado, { gn: 0, gg: 0 });
  // con 'ignorar' el general no coincidente queda sin asignar
  const r2 = asignarGastos(pool, vn, { ...g, sin_asignar: 'ignorar' });
  cerca(r2.noAsignado.gg, 1000);
});

const DATOS = {
  filas: [
    { fecha: '2026-10-02', vendedor: 'A01', sucursal: 'PRI', sub: 900, desc: 100, descAnomalo: 0, dev: 0, costo: 400, nFacturas: 2 },
    { fecha: '2026-10-20', vendedor: 'A01', sucursal: 'PRI', sub: 0, desc: 0, descAnomalo: 0, dev: 0, costo: 0, nFacturas: 0 },
    { fecha: '2026-10-05', vendedor: 'B02', sucursal: 'UIO', sub: 300, desc: 50, descAnomalo: 50, dev: 50, costo: 100, nFacturas: 1 },
    { fecha: '2026-11-01', vendedor: 'B02', sucursal: 'UIO', sub: 777, desc: 0, descAnomalo: 0, dev: 0, costo: 0, nFacturas: 1 }, // fuera de rango
  ],
  pool: [{ fecha: '2026-10-31', dep: '1', pc: '02', cuenta: '61120006', monto: 130 }],
};
const RANGO = { desde: '2026-10-01', hasta: '2026-10-31' };

test('calcular: suma por rango de días, participación y promedios', () => {
  const r = calcular(DATOS, RANGO, {});
  const a = r.asesores.find((x) => x.asesor === 'A01');
  const b = r.asesores.find((x) => x.asesor === 'B02');
  assert.equal(a.vb, 1000); assert.equal(a.dd, 100); assert.equal(a.vn, 900); assert.equal(a.cv, 400);
  assert.equal(b.vb, 350); assert.equal(b.dd, 100); assert.equal(b.vn, 250);
  assert.equal(r.totalNacional.vn, 1150);
  cerca(a.part.vn, 900 / 1150, 1e-9);
  assert.equal(r.asesores[0].asesor, 'A01'); // orden por VN desc
  assert.equal(r.promedio.nAsesores, 2);
  assert.equal(r.promedio.vn, 575);
  assert.equal(r.totalNacional.nFacturas, 3);
  // solo días: 2026-10-05 incluye a B02 pero no la venta de A01 del día 2
  const r2 = calcular(DATOS, { desde: '2026-10-05', hasta: '2026-10-05' }, {});
  assert.deepEqual(r2.asesores.map((x) => x.asesor), ['B02']);
});

test('calcular: gastos sin confirmar -> "Pendiente de configurar"', () => {
  const r = calcular(DATOS, RANGO, { gastos: { ...GASTOS_OK, confirmado: false } });
  assert.equal(r.gastosPendientes, true);
  assert.equal(r.etiquetaGastos, 'Pendiente de configurar');
  for (const x of [...r.asesores, r.totalNacional, r.totalFiltro]) {
    for (const k of ['gn', 'gg', 'gt', 'un', 'u', 'run', 'r']) assert.equal(x[k], null, k);
    assert.ok(x.vn > 0);
  }
  assert.equal(r.asesores[0].semaforo.rentabilidad, null);
  assert.ok(r.asesores[0].semaforo.costo);
});

test('calcular: gastos confirmados se prorratean y cuadran con el total', () => {
  const r = calcular(DATOS, RANGO, { gastos: GASTOS_OK });
  const suma = r.asesores.reduce((s, x) => s + x.gg, 0);
  cerca(suma, 130);
  cerca(r.totalNacional.gg, 130);
  cerca(r.asesores.find((x) => x.asesor === 'A01').gg, 130 * 900 / 1150);
});

test('calcular: filtros por sucursal/área/vendedor; total nacional no cambia', () => {
  const vendedores = [{ codigo: 'A01', sucursal: 'Guayaquil', area: 'Comercial' }, { codigo: 'B02', sucursal: '', area: 'Técnica' }];
  const r = calcular(DATOS, { ...RANGO, sucursales: ['UIO'] }, { vendedores });
  assert.deepEqual(r.asesores.map((x) => x.asesor), ['B02']); // sin sucursal en catálogo -> ORIGEN
  assert.equal(r.totalNacional.vn, 1150);
  assert.equal(r.totalFiltro.vn, 250);
  cerca(r.totalFiltro.part.vn, 250 / 1150, 1e-9);
  assert.deepEqual(calcular(DATOS, { ...RANGO, areas: ['Comercial'] }, { vendedores }).asesores.map((x) => x.asesor), ['A01']);
  assert.deepEqual(calcular(DATOS, { ...RANGO, vendedores: ['B02'] }, { vendedores }).asesores.map((x) => x.asesor), ['B02']);
  assert.equal(r.asesores[0].alias, 'B02');
});

test('regla: ignorar descuento igual a VALOR_FACTURA baja VB y DD pero no VN', () => {
  const normal = calcular(DATOS, RANGO, {}).asesores.find((x) => x.asesor === 'B02');
  const regla = calcular(DATOS, RANGO, { reglas: { vb_ignorar_descuento_igual_valor_factura: true } }).asesores.find((x) => x.asesor === 'B02');
  assert.equal(regla.vb, normal.vb - 50);
  assert.equal(regla.dd, normal.dd - 50);
  assert.equal(regla.vn, normal.vn);
});

test('rangoAnioAnterior (incluye 29 de febrero)', () => {
  assert.deepEqual(rangoAnioAnterior('2026-10-01', '2026-10-31'), { desde: '2025-10-01', hasta: '2025-10-31' });
  assert.deepEqual(rangoAnioAnterior('2028-02-01', '2028-02-29'), { desde: '2027-02-01', hasta: '2027-02-28' });
});
