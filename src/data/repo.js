// Lectura de la caché para la web. NUNCA llama a MBA3.
// Archivos: data/cache/AAAA-MM.json (ver src/sync/scheduler.js). Se memorizan por mtime.

import fs from 'node:fs';
import path from 'node:path';
import { calcular, rangoAnioAnterior } from '../calc/metrics.js';
import { mesesEntre, validarFecha } from '../mba3/queries.js';

export function rutaMes(dataDir, mes) {
  return path.join(dataDir, 'cache', `${mes}.json`);
}

export function crearRepo(cfg) {
  const memo = new Map(); // mes -> { mtimeMs, datos }

  function leerMes(mes) {
    const file = rutaMes(cfg.dataDir, mes);
    let st;
    try { st = fs.statSync(file); } catch { memo.delete(mes); return null; }
    const m = memo.get(mes);
    if (m && m.mtimeMs === st.mtimeMs) return m.datos;
    try {
      const datos = JSON.parse(fs.readFileSync(file, 'utf8'));
      memo.set(mes, { mtimeMs: st.mtimeMs, datos });
      return datos;
    } catch {
      return null; // archivo a medio escribir no debería existir (rename atómico), pero por si acaso
    }
  }

  function cargar(desde, hasta) {
    const filas = [];
    const pool = [];
    const presentes = [];
    const faltantes = [];
    const sincronizado = {};
    for (const mes of mesesEntre(desde, hasta)) {
      const d = leerMes(mes);
      if (!d) { faltantes.push(mes); continue; }
      presentes.push(mes);
      sincronizado[mes] = d.generado;
      filas.push(...d.filas);
      pool.push(...d.pool);
    }
    return { filas, pool, cobertura: { presentes, faltantes, sincronizado } };
  }

  /**
   * Resumen para el tablero: periodo pedido + mismo rango del año anterior (barras grises).
   * @param {{desde:string, hasta:string, sucursales?:string[], areas?:string[], vendedores?:string[]}} filtros
   */
  function resumen(filtros) {
    validarFecha(filtros.desde);
    validarFecha(filtros.hasta);
    if (filtros.desde > filtros.hasta) throw new Error('desde > hasta');
    const ccfg = { gastos: cfg.gastos, vendedores: cfg.vendedores, umbrales: cfg.umbrales, reglas: cfg.reglas };

    const actual = cargar(filtros.desde, filtros.hasta);
    const res = calcular(actual, filtros, ccfg);

    const rAnt = rangoAnioAnterior(filtros.desde, filtros.hasta);
    const anterior = cargar(rAnt.desde, rAnt.hasta);
    const comp = calcular(anterior, { ...filtros, ...rAnt }, ccfg);

    const corto = (a) => ({ vb: a.vb, vn: a.vn, cv: a.cv, ub: a.ub, gt: a.gt, un: a.un, run: a.run, pctD: a.pctD, pctC: a.pctC, pctMB: a.pctMB });
    const fechas = Object.values(actual.cobertura.sincronizado).filter(Boolean).sort();
    return {
      ...res,
      cobertura: actual.cobertura,
      actualizado: fechas.at(-1) ?? null,
      comparativo: {
        ...rAnt,
        cobertura: anterior.cobertura,
        totalFiltro: comp.totalFiltro,
        porAsesor: Object.fromEntries(comp.asesores.map((a) => [a.asesor, corto(a)])),
        porSucursal: Object.fromEntries(comp.porSucursal.map((s) => [s.sucursal, corto(s)])),
      },
    };
  }

  function mesesDisponibles() {
    try {
      return fs.readdirSync(path.join(cfg.dataDir, 'cache')).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 7)).sort();
    } catch {
      return [];
    }
  }

  return { resumen, cargar, mesesDisponibles };
}
