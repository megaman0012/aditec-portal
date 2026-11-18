#!/usr/bin/env node
// Análisis de un mes ya sincronizado (lee SOLO la caché; 0 peticiones a MBA3).
// Uso: docker compose exec aditec-portal node scripts/analizar-mes.js 2026-10
// Guarda el resultado completo en data/exploracion/analisis-<mes>.json
import fs from 'node:fs';
import path from 'node:path';
import { config, salir } from './_comun.js';
import { rutasCache } from '../src/sync/scheduler.js';

const mes = process.argv[2];
if (!/^\d{4}-\d{2}$/.test(mes ?? '')) salir('Uso: node scripts/analizar-mes.js AAAA-MM');
// Lee las filas CRUDAS guardadas con: sync-manual.js --mes=AAAA-MM --crudo
const rutas = rutasCache(config.dataDir);
const leer = (t) => {
  const f = rutas.crudo(t, mes);
  if (!fs.existsSync(f)) salir(`Falta ${f}: ejecuta sync-manual.js --mes=${mes} --crudo primero`);
  return JSON.parse(fs.readFileSync(f, 'utf8')).filas;
};
const fact = leer('facturas');
const mov = leer('movimientos');
const asi = leer('asientos');

const r2 = (x) => Math.round(x * 100) / 100;
const pct = (a, b) => (b ? r2(((a - b) / b) * 100) : null);
const n = (v) => Number(v) || 0;
function contar(filas, campo) {
  const m = {};
  for (const f of filas) { const k = JSON.stringify(f[campo]); m[k] = (m[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}
function tipos(filas, campo) { return [...new Set(filas.map((f) => (f[campo] === null ? 'null' : typeof f[campo])))]; }
function formatoFechas(filas, campo) {
  const fmts = {};
  for (const f of filas) {
    const v = String(f[campo]);
    const k = /^\d{4}-\d{2}-\d{2}$/.test(v) ? 'AAAA-MM-DD' : v.replace(/\d/g, '9');
    fmts[k] = (fmts[k] ?? 0) + 1;
  }
  const vals = filas.map((f) => String(f[campo])).sort();
  return { formatos: fmts, min: vals[0], max: vals.at(-1) };
}

// ---------- 1. Facturas ----------
const factOk = fact.filter((f) => f.TIPO_DOCUMENTO === 'FACT' && f.ANULADA !== true);
const tot = (filas, fn) => r2(filas.reduce((s, f) => s + fn(f), 0));
const facturas = {
  filas: fact.length,
  validas: factOk.length,
  fecha: formatoFechas(fact, 'FECHA_FACTURA'),
  anulada: { tipos: tipos(fact, 'ANULADA'), valores: contar(fact, 'ANULADA') },
  tipo_documento: contar(fact, 'TIPO_DOCUMENTO'),
  origen: contar(fact, 'ORIGEN'),
  vendedores: contar(fact, 'VENDEDOR'),
  totales_validas: {
    SUBTOTAL_CON_IVA: tot(factOk, (f) => n(f.SUBTOTAL_CON_IVA)),
    SUBTOTAL_SIN_IVA: tot(factOk, (f) => n(f.SUBTOTAL_SIN_IVA)),
    VALOR_TOTAL_DESCUENTO: tot(factOk, (f) => n(f.VALOR_TOTAL_DESCUENTO)),
    TOTAL_DEVOLUCION: tot(factOk, (f) => n(f.TOTAL_DEVOLUCION)),
    VALOR_FACTURA: tot(factOk, (f) => n(f.VALOR_FACTURA)),
  },
  totales_anuladas: { n: fact.length - factOk.length, VALOR_FACTURA: tot(fact.filter((f) => f.ANULADA === true), (f) => n(f.VALOR_FACTURA)) },
};

// ---------- 2. Movimientos ----------
const movOk = mov.filter((m) => m.ADJUSTMENT_TYPE === 'FT' && m.Anulada !== true);
const vendFact = new Set(fact.map((f) => f.VENDEDOR));
const vendMov = new Set(mov.map((m) => m.COD_SALESMAN));
const movimientos = {
  filas: mov.length,
  validas: movOk.length,
  fecha: formatoFechas(mov, 'TRANS_DATE'),
  adjustment_type: contar(mov, 'ADJUSTMENT_TYPE'),
  anulada: { tipos: tipos(mov, 'Anulada'), valores: contar(mov, 'Anulada') },
  cod_salesman: contar(mov, 'COD_SALESMAN'),
  coincidencia_vendedores: {
    en_ambos: [...vendFact].filter((v) => vendMov.has(v)).sort(),
    solo_facturas: [...vendFact].filter((v) => !vendMov.has(v)).sort(),
    solo_movimientos: [...vendMov].filter((v) => !vendFact.has(v)).sort(),
  },
  totales_validas: {
    LINE_TOTAL: tot(movOk, (m) => n(m.LINE_TOTAL)),
    DISCOUNT_AMOUNT: tot(movOk, (m) => n(m.DISCOUNT_AMOUNT)),
    NET_LINE_TOTAL: tot(movOk, (m) => n(m.NET_LINE_TOTAL)),
    TOT_RETURN_AMOUNT: tot(movOk, (m) => n(m.TOT_RETURN_AMOUNT)),
    CV_formula: tot(movOk, (m) => (n(m.QUANTITY) - n(m.TOT_RETURN_UNIT)) * n(m.TRANS_COST)),
    CV_sin_devol: tot(movOk, (m) => n(m.QUANTITY) * n(m.TRANS_COST)),
  },
};

// ---------- 3 y 4. Cuadre por vendedor y variantes de VB ----------
const porV = new Map();
const g = (k) => {
  if (!porV.has(k)) porV.set(k, { sub: 0, desc: 0, devol: 0, vf: 0, nlt: 0, lt: 0, ret: 0, disc: 0 });
  return porV.get(k);
};
for (const f of factOk) {
  const b = g(f.VENDEDOR);
  b.sub += n(f.SUBTOTAL_CON_IVA) + n(f.SUBTOTAL_SIN_IVA);
  b.desc += n(f.VALOR_TOTAL_DESCUENTO);
  b.devol += n(f.TOTAL_DEVOLUCION);
  b.vf += n(f.VALOR_FACTURA);
}
for (const m of movOk) {
  const b = g(m.COD_SALESMAN);
  b.nlt += n(m.NET_LINE_TOTAL);
  b.lt += n(m.LINE_TOTAL);
  b.ret += n(m.TOT_RETURN_AMOUNT);
  b.disc += n(m.DISCOUNT_AMOUNT);
}
const cuadre = [...porV.entries()].map(([v, b]) => ({
  vendedor: v,
  subtotal_fact: r2(b.sub),
  net_line_total_mov: r2(b.nlt),
  dif_pct: pct(b.nlt, b.sub),
  descuento_fact: r2(b.desc),
  devolucion_fact: r2(b.devol),
  vb_A_sub_mas_desc: r2(b.sub + b.desc),
  vb_B_valor_factura: r2(b.vf),
  line_total_mov: r2(b.lt),
  disc_mov: r2(b.disc),
  ret_mov: r2(b.ret),
})).sort((a, b) => b.subtotal_fact - a.subtotal_fact);
const T = (k) => r2(cuadre.reduce((s, c) => s + c[k], 0));
const cuadreTotal = {
  subtotal_fact: T('subtotal_fact'),
  net_line_total_mov: T('net_line_total_mov'),
  dif_pct: pct(T('net_line_total_mov'), T('subtotal_fact')),
  vb_A_sub_mas_desc: T('vb_A_sub_mas_desc'),
  vb_B_valor_factura: T('vb_B_valor_factura'),
  line_total_mov: T('line_total_mov'),
  disc_mov: T('disc_mov'),
  ret_mov: T('ret_mov'),
  devolucion_fact: T('devolucion_fact'),
  descuento_fact: T('descuento_fact'),
};

// Relación VALOR_FACTURA / subtotal (¿IVA?)
const ratios = {};
for (const f of factOk) {
  const sub = n(f.SUBTOTAL_CON_IVA) + n(f.SUBTOTAL_SIN_IVA);
  if (!n(f.SUBTOTAL_CON_IVA) || n(f.SUBTOTAL_SIN_IVA)) continue;
  const k = (n(f.VALOR_FACTURA) / sub).toFixed(3);
  ratios[k] = (ratios[k] ?? 0) + 1;
}

// ---------- 5. Gastos ----------
const neto = (a) => n(a.DEBIT_AMOUNT) - n(a.CREDIT_AMOUNT);
function agrupar(fn) {
  const m = {};
  for (const a of asi) {
    const k = fn(a);
    m[k] ??= { filas: 0, neto: 0, nombre: a.ACCOUNT_NAME };
    m[k].filas++;
    m[k].neto += neto(a);
  }
  return Object.fromEntries(Object.entries(m).sort((x, y) => x[0].localeCompare(y[0])).map(([k, v]) => [k, { ...v, neto: r2(v.neto) }]));
}
const gastos = {
  filas: asi.length,
  fecha: asi.length ? formatoFechas(asi, 'POST_TO_DATE') : null,
  department_code: agrupar((a) => a.DEPARTMENT_CODE || '(vacío)'),
  profit_center_code: agrupar((a) => a.PROFIT_CENTER_CODE || '(vacío)'),
  sucursal: agrupar((a) => a.Analisis_Sucursal || '(vacío)'),
  prefijo_2: agrupar((a) => String(a.GL_ACCOUNT_CODE).slice(0, 2)),
  prefijo_4: agrupar((a) => String(a.GL_ACCOUNT_CODE).slice(0, 4)),
  cuenta_principal: agrupar((a) => a.GL_MAIN_CODE_ONLY),
  dep_x_pc: agrupar((a) => `${a.DEPARTMENT_CODE || '-'}|${a.PROFIT_CENTER_CODE || '-'}`),
};

const salida = { mes, generado: new Date().toISOString(), facturas, movimientos, cuadre: { por_vendedor: cuadre, total: cuadreTotal }, ratio_valor_factura_sobre_subtotal: ratios, gastos };
const dir = path.join(config.dataDir, 'exploracion');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `analisis-${mes}.json`), JSON.stringify(salida, null, 2));
console.log(JSON.stringify(salida, null, 1));
