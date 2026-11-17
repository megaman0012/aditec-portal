// Fórmulas "Resultados por vendedor" (réplica del Excel). Funciones PURAS, sin E/S.
// Divisiones entre 0 -> null (la web muestra "—").

export const div = (a, b) => (b === 0 || b == null || a == null || !Number.isFinite(a / b) ? null : a / b);
const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const esSi = (v) => v === true || v === 1 || /^(s|si|sí|true|1|y|yes)$/i.test(String(v ?? '').trim());

// Factura válida: tipo 'FACT' y no anulada.
export function facturaValida(f) {
  return String(f.TIPO_DOCUMENTO ?? '').trim() === 'FACT' && !esSi(f.ANULADA);
}

// VB (fórmula provisional, validar en Fase 4) y DD por factura.
export function ventasDeFactura(f) {
  const descuento = n(f.VALOR_TOTAL_DESCUENTO);
  const vb = n(f.SUBTOTAL_CON_IVA) + n(f.SUBTOTAL_SIN_IVA) + descuento;
  const dd = descuento + n(f.TOTAL_DEVOLUCION);
  return { vb, dd };
}

// Costo de un movimiento FT no anulado: (QUANTITY - TOT_RETURN_UNIT) * TRANS_COST (unitario).
export function movimientoValido(m) {
  return String(m.ADJUSTMENT_TYPE ?? '').trim() === 'FT' && !esSi(m.Anulada);
}
export function costoDeMovimiento(m) {
  return (n(m.QUANTITY) - n(m.TOT_RETURN_UNIT)) * n(m.TRANS_COST);
}

// Indicadores a partir de las bases { vb, dd, cv, gn, gg }.
export function indicadores({ vb = 0, dd = 0, cv = 0, gn = 0, gg = 0 }) {
  const vn = vb - dd;
  const ub = vn - cv;
  const gt = gn + gg;
  const un = ub - gt;
  const u = vn - gt;
  return {
    vb, dd, vn, cv, ub, gn, gg, gt, un, u,
    run: div(un, vn),
    r: div(u, vn),
    pctD: div(dd, vb),
    pctC: div(cv, vn),
    pctMB: div(ub, vn),
  };
}

// Agrega por asesor. gastosPorAsesor: { [asesor]: { gn, gg } } (origen definido en Fase 4).
export function resumenPorAsesor({ facturas = [], movimientos = [], gastosPorAsesor = {} }) {
  const base = new Map();
  const get = (k) => {
    const key = String(k ?? '').trim() || '(sin asesor)';
    if (!base.has(key)) base.set(key, { vb: 0, dd: 0, cv: 0, gn: 0, gg: 0 });
    return base.get(key);
  };
  for (const f of facturas) {
    if (!facturaValida(f)) continue;
    const { vb, dd } = ventasDeFactura(f);
    const b = get(f.VENDEDOR);
    b.vb += vb;
    b.dd += dd;
  }
  for (const m of movimientos) {
    if (!movimientoValido(m)) continue;
    get(m.COD_SALESMAN).cv += costoDeMovimiento(m);
  }
  for (const [asesor, g] of Object.entries(gastosPorAsesor)) {
    const b = get(asesor);
    b.gn += n(g.gn);
    b.gg += n(g.gg);
  }

  const total = { vb: 0, dd: 0, cv: 0, gn: 0, gg: 0 };
  for (const b of base.values()) for (const k of Object.keys(total)) total[k] += b[k];
  const totalInd = indicadores(total);

  const RUBROS = ['vb', 'dd', 'vn', 'cv', 'ub', 'gn', 'gg', 'gt', 'un', 'u'];
  const asesores = [...base.entries()]
    .map(([asesor, b]) => {
      const ind = indicadores(b);
      const part = Object.fromEntries(RUBROS.map((r) => [r, div(ind[r], totalInd[r])]));
      return { asesor, ...ind, part };
    })
    .sort((a, b) => b.vn - a.vn);

  return { asesores, total: totalInd };
}
