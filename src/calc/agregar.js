// Agregación de un MES (funciones puras, sin E/S).
// De las filas crudas de MBA3 se guarda SOLO lo necesario para calcular por cualquier rango de
// fechas: filas por vendedor y día, y un "pool" de gastos por día/departamento/centro/cuenta.
// No se guardan facturas, clientes ni empleados.

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
// 4 decimales en caché: evita arrastre de redondeo al sumar cientos de filas (se redondea a 2 al mostrar)
const r2 = (x) => Math.round(x * 10000) / 10000;
const esSi = (v) => v === true || v === 1 || /^(s|si|sí|true|1|y|yes)$/i.test(String(v ?? '').trim());
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Factura válida: tipo 'FACT' y no anulada.
export function facturaValida(f) {
  return String(f.TIPO_DOCUMENTO ?? '').trim() === 'FACT' && !esSi(f.ANULADA);
}

// Movimiento de costo válido: 'FT' y no anulado.
export function movimientoValido(m) {
  return String(m.ADJUSTMENT_TYPE ?? '').trim() === 'FT' && !esSi(m.Anulada);
}

// Costo: (QUANTITY - TOT_RETURN_UNIT) * TRANS_COST (unitario).
export function costoDeMovimiento(m) {
  return (n(m.QUANTITY) - n(m.TOT_RETURN_UNIT)) * n(m.TRANS_COST);
}

// Anomalía Fase 4: descuento == VALOR_FACTURA (con IVA). Se guarda aparte para que la regla
// "ignorar" se pueda activar en config/reglas.json sin volver a descargar.
export function descuentoAnomalo(f) {
  const d = n(f.VALOR_TOTAL_DESCUENTO);
  return d > 0 && Math.abs(d - n(f.VALOR_FACTURA)) < 0.01 ? d : 0;
}

const codigo = (v) => String(v ?? '').trim() || '(sin asesor)';

/**
 * @param {{mes:string, facturas:object[], movimientos:object[], asientos:object[]}} p
 * @returns {{filas:object[], pool:object[], cuentas:Record<string,string>, conteo:object, descartes:object}}
 */
export function agregarMes({ mes, facturas = [], movimientos = [], asientos = [] }) {
  const enMes = (f) => FECHA.test(f) && f.startsWith(mes);
  const descartes = { facturasAnuladas: 0, facturasOtroTipo: 0, movimientosAnulados: 0, fechaFueraDeMes: 0 };
  const filas = new Map();
  const fila = (fecha, vendedor) => {
    const k = `${fecha}|${vendedor}`;
    if (!filas.has(k)) {
      filas.set(k, {
        fecha, vendedor, sucursal: '', sub: 0, desc: 0, descAnomalo: 0, dev: 0, costo: 0,
        gastoNomina: null, gastoGeneral: null, nFacturas: 0, _origen: {},
      });
    }
    return filas.get(k);
  };

  for (const f of facturas) {
    if (!enMes(f.FECHA_FACTURA)) { descartes.fechaFueraDeMes++; continue; }
    if (!facturaValida(f)) {
      if (esSi(f.ANULADA)) descartes.facturasAnuladas++;
      else descartes.facturasOtroTipo++;
      continue;
    }
    const r = fila(f.FECHA_FACTURA, codigo(f.VENDEDOR));
    r.sub += n(f.SUBTOTAL_CON_IVA) + n(f.SUBTOTAL_SIN_IVA);
    r.desc += n(f.VALOR_TOTAL_DESCUENTO);
    r.descAnomalo += descuentoAnomalo(f);
    r.dev += n(f.TOTAL_DEVOLUCION);
    r.nFacturas++;
    const o = String(f.ORIGEN ?? '').trim();
    if (o) r._origen[o] = (r._origen[o] ?? 0) + 1;
  }

  for (const m of movimientos) {
    if (!enMes(m.TRANS_DATE)) { descartes.fechaFueraDeMes++; continue; }
    if (!movimientoValido(m)) { descartes.movimientosAnulados++; continue; }
    fila(m.TRANS_DATE, codigo(m.COD_SALESMAN)).costo += costoDeMovimiento(m);
  }

  const pool = new Map();
  const cuentas = {};
  for (const a of asientos) {
    if (!enMes(a.POST_TO_DATE)) { descartes.fechaFueraDeMes++; continue; }
    const cuenta = String(a.GL_MAIN_CODE_ONLY || String(a.GL_ACCOUNT_CODE ?? '').slice(0, 8));
    const dep = String(a.DEPARTMENT_CODE ?? '').trim();
    const pc = String(a.PROFIT_CENTER_CODE ?? '').trim();
    const k = `${a.POST_TO_DATE}|${dep}|${pc}|${cuenta}`;
    if (!pool.has(k)) pool.set(k, { fecha: a.POST_TO_DATE, dep, pc, cuenta, monto: 0 });
    pool.get(k).monto += n(a.DEBIT_AMOUNT) - n(a.CREDIT_AMOUNT);
    if (a.ACCOUNT_NAME && !cuentas[cuenta]) cuentas[cuenta] = String(a.ACCOUNT_NAME).trim();
  }

  const filasOut = [...filas.values()]
    .map(({ _origen, ...r }) => ({
      ...r,
      // sucursal = ORIGEN predominante del día (PRI/UIO). Los filtros usan vendedores.json.
      sucursal: Object.entries(_origen).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
      sub: r2(r.sub), desc: r2(r.desc), descAnomalo: r2(r.descAnomalo), dev: r2(r.dev), costo: r2(r.costo),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.vendedor.localeCompare(b.vendedor));
  const poolOut = [...pool.values()]
    .map((p) => ({ ...p, monto: r2(p.monto) }))
    .filter((p) => p.monto !== 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.cuenta.localeCompare(b.cuenta));

  return {
    filas: filasOut,
    pool: poolOut,
    cuentas,
    conteo: { facturas: facturas.length, movimientos: movimientos.length, asientos: asientos.length },
    descartes,
  };
}
