#!/usr/bin/env node
// Verificación independiente: consulta MBA3 para UN vendedor en UN mes (login + 2 consultas),
// calcula VB/DD/VN/CV con código propio (no usa agregar.js ni metrics.js) y compara con lo que
// muestra el tablero (caché). También reporta el cuadre facturas vs movimientos (NET_LINE_TOTAL).
// Uso: docker compose exec aditec-portal node scripts/verificar-vendedor.js <VENDEDOR> <AAAA-MM>
import { crearCliente, config, salir } from './_comun.js';
import { crearRepo } from '../src/data/repo.js';
import { rangoDeMes } from '../src/mba3/queries.js';

const [vendedor, mes] = process.argv.slice(2);
if (!/^[A-Za-z0-9._-]{1,20}$/.test(vendedor ?? '') || !/^\d{4}-\d{2}$/.test(mes ?? '')) {
  salir('Uso: node scripts/verificar-vendedor.js <VENDEDOR> <AAAA-MM>');
}
const { desde, hasta } = rangoDeMes(mes);
const E = config.mba3.empresa;

const c = crearCliente('verificar-vendedor');
const fact = await c.consultar({
  select: 'FECHA_FACTURA,VENDEDOR,TIPO_DOCUMENTO,ANULADA,SUBTOTAL_CON_IVA,SUBTOTAL_SIN_IVA,VALOR_TOTAL_DESCUENTO,TOTAL_DEVOLUCION',
  from: 'CLNT_Factura_Principal',
  where: `EMPRESA = '${E}' AND VENDEDOR = '${vendedor}' AND FECHA_FACTURA >= '${desde}' AND FECHA_FACTURA <= '${hasta}'`,
  limit: 3000,
});
const mov = await c.consultar({
  select: 'TRANS_DATE,COD_SALESMAN,ADJUSTMENT_TYPE,Anulada,QUANTITY,TOT_RETURN_UNIT,TRANS_COST,NET_LINE_TOTAL',
  from: 'INVT_Producto_Movimientos',
  where: `CORP = '${E}' AND COD_SALESMAN = '${vendedor}' AND ADJUSTMENT_TYPE = 'FT' AND TRANS_DATE >= '${desde}' AND TRANS_DATE <= '${hasta}'`,
  limit: 3000,
});
if (fact.length >= 3000 || mov.length >= 3000) salir('Demasiadas filas para una verificación simple (>= 3000).');

// Cálculo manual, línea por línea
let sub = 0, desc = 0, dev = 0, n = 0, anuladas = 0;
for (const f of fact) {
  if (f.ANULADA === true || f.TIPO_DOCUMENTO !== 'FACT') { anuladas++; continue; }
  sub += f.SUBTOTAL_CON_IVA + f.SUBTOTAL_SIN_IVA;
  desc += f.VALOR_TOTAL_DESCUENTO;
  dev += f.TOTAL_DEVOLUCION;
  n++;
}
let cv = 0, nlt = 0;
for (const m of mov) {
  if (m.Anulada === true) continue;
  cv += (m.QUANTITY - m.TOT_RETURN_UNIT) * m.TRANS_COST;
  nlt += m.NET_LINE_TOTAL;
}
const manual = { vb: sub + desc, dd: desc + dev, vn: sub - dev, cv, nFacturas: n };

// Lo que muestra el tablero (caché)
const t = crearRepo(config).resumen({ desde, hasta, vendedores: [vendedor] });
const a = t.asesores.find((x) => x.asesor === vendedor);
if (!a) salir(`El tablero no tiene datos de ${vendedor} en ${mes} (¿mes sincronizado?)`);

const r2 = (x) => Math.round(x * 100) / 100;
console.log(`Verificación ${vendedor} ${mes} · ${fact.length} facturas MBA3 (${anuladas} anuladas/no FACT) · ${mov.length} movimientos FT`);
console.log('rubro            MBA3 manual      tablero     diferencia');
let ok = true;
for (const k of ['vb', 'dd', 'vn', 'cv', 'nFacturas']) {
  const d = r2(a[k] - manual[k]);
  if (Math.abs(d) > 0.01) ok = false;
  console.log(`${k.padEnd(10)} ${String(r2(manual[k])).padStart(14)} ${String(r2(a[k])).padStart(13)} ${String(d).padStart(12)}`);
}
const difPct = sub ? ((nlt - sub) / sub) * 100 : null;
console.log(`Cuadre facturas vs movimientos: Σ subtotal ${r2(sub)} · Σ NET_LINE_TOTAL ${r2(nlt)} · diferencia ${difPct == null ? '—' : difPct.toFixed(4)} %`);
console.log(`Peticiones a MBA3: ${c.peticiones} · resultado: ${ok ? 'OK (cuadra al centavo)' : 'DIFERENCIAS'}`);
process.exit(ok ? 0 : 1);
