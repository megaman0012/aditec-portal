import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agregarMes, facturaValida, descuentoAnomalo } from '../src/calc/agregar.js';

test('facturaValida: excluye anuladas y no FACT', () => {
  assert.equal(facturaValida({ TIPO_DOCUMENTO: 'FACT', ANULADA: false }), true);
  assert.equal(facturaValida({ TIPO_DOCUMENTO: 'FACT', ANULADA: true }), false);
  assert.equal(facturaValida({ TIPO_DOCUMENTO: 'NC', ANULADA: false }), false);
});

test('descuentoAnomalo: solo cuando descuento == VALOR_FACTURA', () => {
  assert.equal(descuentoAnomalo({ VALOR_TOTAL_DESCUENTO: 249.26, VALOR_FACTURA: 249.26 }), 249.26);
  assert.equal(descuentoAnomalo({ VALOR_TOTAL_DESCUENTO: 10, VALOR_FACTURA: 249.26 }), 0);
});

test('agregarMes: filas por día/vendedor, pool de gastos, sin datos crudos', () => {
  const r = agregarMes({
    mes: '2026-10',
    facturas: [
      { FECHA_FACTURA: '2026-10-02', VENDEDOR: 'A01', ORIGEN: 'PRI', TIPO_DOCUMENTO: 'FACT', ANULADA: false, SUBTOTAL_CON_IVA: 600, SUBTOTAL_SIN_IVA: 300, VALOR_TOTAL_DESCUENTO: 100, TOTAL_DEVOLUCION: 0, VALOR_FACTURA: 1000 },
      { FECHA_FACTURA: '2026-10-02', VENDEDOR: 'A01', ORIGEN: 'UIO', TIPO_DOCUMENTO: 'FACT', ANULADA: false, SUBTOTAL_CON_IVA: 100, SUBTOTAL_SIN_IVA: 0, VALOR_TOTAL_DESCUENTO: 0, TOTAL_DEVOLUCION: 10, VALOR_FACTURA: 115 },
      { FECHA_FACTURA: '2026-10-02', VENDEDOR: 'A01', ORIGEN: 'PRI', TIPO_DOCUMENTO: 'FACT', ANULADA: true, SUBTOTAL_CON_IVA: 9999 },
      { FECHA_FACTURA: '2026-09-30', VENDEDOR: 'A01', TIPO_DOCUMENTO: 'FACT', ANULADA: false, SUBTOTAL_CON_IVA: 5 },
    ],
    movimientos: [
      { TRANS_DATE: '2026-10-02', COD_SALESMAN: 'A01', ADJUSTMENT_TYPE: 'FT', Anulada: false, QUANTITY: 10, TOT_RETURN_UNIT: 2, TRANS_COST: 5 },
      { TRANS_DATE: '2026-10-03', COD_SALESMAN: 'B02', ADJUSTMENT_TYPE: 'FT', Anulada: true, QUANTITY: 10, TRANS_COST: 5 },
    ],
    asientos: [
      { POST_TO_DATE: '2026-10-31', GL_ACCOUNT_CODE: '61110001100', GL_MAIN_CODE_ONLY: '61110001', ACCOUNT_NAME: 'GP.SUELDOS', DEPARTMENT_CODE: '1', PROFIT_CENTER_CODE: '01', DEBIT_AMOUNT: 500, CREDIT_AMOUNT: 0 },
      { POST_TO_DATE: '2026-10-31', GL_ACCOUNT_CODE: '61110001100', GL_MAIN_CODE_ONLY: '61110001', DEPARTMENT_CODE: '1', PROFIT_CENTER_CODE: '01', DEBIT_AMOUNT: 0, CREDIT_AMOUNT: 20 },
    ],
  });
  assert.equal(r.filas.length, 1);
  const f = r.filas[0];
  assert.deepEqual(
    { fecha: f.fecha, vendedor: f.vendedor, sub: f.sub, desc: f.desc, dev: f.dev, costo: f.costo, nFacturas: f.nFacturas, sucursal: f.sucursal },
    { fecha: '2026-10-02', vendedor: 'A01', sub: 1000, desc: 100, dev: 10, costo: 40, nFacturas: 2, sucursal: 'PRI' },
  );
  assert.equal(f.gastoNomina, null);
  assert.deepEqual(r.pool, [{ fecha: '2026-10-31', dep: '1', pc: '01', cuenta: '61110001', monto: 480 }]);
  assert.equal(r.cuentas['61110001'], 'GP.SUELDOS');
  assert.equal(r.descartes.facturasAnuladas, 1);
  assert.equal(r.descartes.fechaFueraDeMes, 1);
  assert.equal(r.descartes.movimientosAnulados, 1);
  // Ningún campo crudo con datos de clientes/empleados
  assert.ok(!JSON.stringify(r).includes('SUBTOTAL_CON_IVA'));
});
