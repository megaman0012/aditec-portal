import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indicadores, resumenPorAsesor, div, facturaValida } from '../src/calc/metrics.js';

const cerca = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('div entre 0 devuelve null', () => {
  assert.equal(div(10, 0), null);
  assert.equal(div(0, 0), null);
  assert.equal(div(5, 2), 2.5);
});

test('indicadores: cadena VB -> UN y porcentajes', () => {
  const i = indicadores({ vb: 1000, dd: 100, cv: 500, gn: 150, gg: 50 });
  assert.equal(i.vn, 900);
  assert.equal(i.ub, 400);
  assert.equal(i.gt, 200);
  assert.equal(i.un, 200);
  assert.equal(i.u, 700);
  cerca(i.run, 200 / 900);
  cerca(i.r, 700 / 900);
  cerca(i.pctD, 0.1);
  cerca(i.pctC, 500 / 900);
  cerca(i.pctMB, 400 / 900);
});

test('indicadores sin ventas -> porcentajes null', () => {
  const i = indicadores({ gn: 10 });
  assert.equal(i.vn, 0);
  assert.equal(i.run, null);
  assert.equal(i.pctD, null);
});

test('excluye anuladas y documentos que no son FACT', () => {
  assert.equal(facturaValida({ TIPO_DOCUMENTO: 'FACT', ANULADA: false }), true);
  assert.equal(facturaValida({ TIPO_DOCUMENTO: 'FACT', ANULADA: 'S' }), false);
  assert.equal(facturaValida({ TIPO_DOCUMENTO: 'NC', ANULADA: false }), false);
});

test('resumen por asesor con participación nacional', () => {
  const facturas = [
    { VENDEDOR: 'A01', TIPO_DOCUMENTO: 'FACT', ANULADA: false, SUBTOTAL_CON_IVA: 600, SUBTOTAL_SIN_IVA: 300, VALOR_TOTAL_DESCUENTO: 100, TOTAL_DEVOLUCION: 0 },
    { VENDEDOR: 'B02', TIPO_DOCUMENTO: 'FACT', ANULADA: false, SUBTOTAL_CON_IVA: 300, SUBTOTAL_SIN_IVA: 0, VALOR_TOTAL_DESCUENTO: 0, TOTAL_DEVOLUCION: 50 },
    { VENDEDOR: 'B02', TIPO_DOCUMENTO: 'FACT', ANULADA: true, SUBTOTAL_CON_IVA: 9999 },
  ];
  const movimientos = [
    { COD_SALESMAN: 'A01', ADJUSTMENT_TYPE: 'FT', Anulada: false, QUANTITY: 10, TOT_RETURN_UNIT: 0, TRANS_COST: 40 },
    { COD_SALESMAN: 'B02', ADJUSTMENT_TYPE: 'FT', Anulada: false, QUANTITY: 5, TOT_RETURN_UNIT: 1, TRANS_COST: 25 },
    { COD_SALESMAN: 'B02', ADJUSTMENT_TYPE: 'XX', Anulada: false, QUANTITY: 100, TRANS_COST: 100 },
  ];
  const { asesores, total } = resumenPorAsesor({ facturas, movimientos, gastosPorAsesor: { A01: { gn: 100, gg: 0 } } });
  const a = asesores.find((x) => x.asesor === 'A01');
  const b = asesores.find((x) => x.asesor === 'B02');
  assert.equal(a.vb, 1000); assert.equal(a.dd, 100); assert.equal(a.vn, 900); assert.equal(a.cv, 400);
  assert.equal(b.vb, 300); assert.equal(b.dd, 50); assert.equal(b.vn, 250); assert.equal(b.cv, 100);
  assert.equal(total.vn, 1150);
  cerca(a.part.vn, 900 / 1150);
  assert.equal(b.part.gn, 0);
  assert.equal(asesores[0].asesor, 'A01'); // orden por VN desc
});

test('gastos sin confirmar: GN, GG, GT, UN, U, RUN y R quedan null ("Pendiente de configurar")', () => {
  const facturas = [{ VENDEDOR: 'A01', TIPO_DOCUMENTO: 'FACT', ANULADA: false, SUBTOTAL_CON_IVA: 100, SUBTOTAL_SIN_IVA: 0, VALOR_TOTAL_DESCUENTO: 0, TOTAL_DEVOLUCION: 0 }];
  const { asesores, total, gastosPendientes } = resumenPorAsesor({ facturas, movimientos: [] });
  assert.equal(gastosPendientes, true);
  for (const r of [asesores[0], total]) {
    for (const k of ['gn', 'gg', 'gt', 'un', 'u', 'run', 'r']) assert.equal(r[k], null, k);
    assert.equal(r.vn, 100); // ventas y margen siguen funcionando
    assert.equal(r.pctMB, 1);
  }
  assert.equal(asesores[0].part.gt, null);
});
