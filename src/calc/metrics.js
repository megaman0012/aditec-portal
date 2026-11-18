// Fórmulas "Resultados por vendedor" (réplica del Excel). Funciones PURAS, sin E/S.
// Divisiones entre 0 -> null (la web muestra "—").
//
// VB  = sub + desc            (sub = SUBTOTAL_CON_IVA + SUBTOTAL_SIN_IVA; validado Fase 4, opción A)
// DD  = desc + dev            VN = VB - DD           CV = Σ (QUANTITY - TOT_RETURN_UNIT) * TRANS_COST
// UB  = VN - CV               GT = GN + GG           UN = UB - GT          U = VN - GT
// RUN = UN / VN               R = U / VN             %D = DD / VB          %C = CV / VN     %MB = UB / VN

export const div = (a, b) => (b === 0 || b == null || a == null || !Number.isFinite(a / b) ? null : a / b);
export const ETIQUETA_PENDIENTE = 'Pendiente de configurar';
const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

export const RUBROS = ['vb', 'dd', 'vn', 'cv', 'ub', 'gn', 'gg', 'gt', 'un', 'u'];

// ---------------------------------------------------------------------------
// Indicadores a partir de las bases { vb, dd, cv, gn, gg }.
// gn/gg = null -> gastos "Pendiente de configurar": GT, UN, U, RUN y R también quedan null.
export function indicadores({ vb = 0, dd = 0, cv = 0, gn = 0, gg = 0 }) {
  const vn = vb - dd;
  const ub = vn - cv;
  const gastosPendientes = gn == null || gg == null;
  const gt = gastosPendientes ? null : gn + gg;
  const un = gastosPendientes ? null : ub - gt;
  const u = gastosPendientes ? null : vn - gt;
  return {
    gastosPendientes,
    vb, dd, vn, cv, ub,
    gn: gastosPendientes ? null : gn,
    gg: gastosPendientes ? null : gg,
    gt, un, u,
    run: div(un, vn),
    r: div(u, vn),
    pctD: div(dd, vb),
    pctC: div(cv, vn),
    pctMB: div(ub, vn),
  };
}

// ---------------------------------------------------------------------------
// Semáforo. umbrales: { rentabilidad:{campo, verde_min, amarillo_min}, descuentos:{campo, verde_max, amarillo_max}, ... }
export const UMBRALES_DEFECTO = Object.freeze({
  rentabilidad: { campo: 'run', verde_min: 0.15, amarillo_min: 0.05 },
  descuentos: { campo: 'pctD', verde_max: 0.03, amarillo_max: 0.06 },
  costo: { campo: 'pctC', verde_max: 0.4, amarillo_max: 0.5 },
});

export function semaforo(valor, regla) {
  if (valor == null || !regla) return null;
  if (regla.verde_min != null) {
    if (valor >= regla.verde_min) return 'verde';
    if (valor >= regla.amarillo_min) return 'amarillo';
    return 'rojo';
  }
  if (valor <= regla.verde_max) return 'verde';
  if (valor <= regla.amarillo_max) return 'amarillo';
  return 'rojo';
}

function semaforos(ind, umbrales) {
  return Object.fromEntries(Object.entries(umbrales).map(([k, regla]) => [k, semaforo(ind[regla.campo], regla)]));
}

// ---------------------------------------------------------------------------
// Gastos: clasificación de cuentas por prefijo y asignación a asesores.
export function clasificarCuenta(cuenta, g) {
  const c = String(cuenta);
  if ((g.excluir_prefijos ?? []).some((p) => c.startsWith(p))) return null;
  if ((g.nomina_prefijos ?? []).some((p) => c.startsWith(p))) return 'nomina';
  if ((g.generales_prefijos ?? []).some((p) => c.startsWith(p))) return 'general';
  return null;
}

/**
 * Reparte el pool de gastos del rango entre asesores.
 * - Cada entrada (dep, pc) va a los asesores cuya asignación coincide con ese departamento y centro,
 *   en proporción a sus ventas netas (VN > 0).
 * - Si nadie coincide: sin_asignar = 'prorratear_por_ventas_netas' -> todos los asesores por VN;
 *   'ignorar' -> queda en noAsignado.
 * @returns {{porAsesor: Record<string,{gn:number,gg:number}>, noAsignado:{gn:number,gg:number}}}
 */
export function asignarGastos(pool, vnPorAsesor, g) {
  const porAsesor = {};
  const noAsignado = { gn: 0, gg: 0 };
  for (const a of Object.keys(vnPorAsesor)) porAsesor[a] = { gn: 0, gg: 0 };
  const peso = (lista) => {
    const ps = lista.map((a) => [a, Math.max(0, vnPorAsesor[a] ?? 0)]).filter(([, v]) => v > 0);
    const tot = ps.reduce((s, [, v]) => s + v, 0);
    return tot > 0 ? ps.map(([a, v]) => [a, v / tot]) : [];
  };
  const asignacion = g.asignacion ?? {};
  const todos = peso(Object.keys(vnPorAsesor));
  const grupos = new Map(); // "dep|pc" -> pesos
  const pesosDe = (dep, pc) => {
    const k = `${dep}|${pc}`;
    if (!grupos.has(k)) {
      const lista = Object.keys(vnPorAsesor).filter((a) => asignacion[a]?.department_code === dep && asignacion[a]?.profit_center_code === pc);
      grupos.set(k, peso(lista));
    }
    return grupos.get(k);
  };

  for (const e of pool) {
    const clase = clasificarCuenta(e.cuenta, g);
    if (!clase) continue;
    const campo = clase === 'nomina' ? 'gn' : 'gg';
    let destino = pesosDe(e.dep, e.pc);
    if (!destino.length) destino = g.sin_asignar === 'ignorar' ? [] : todos;
    if (!destino.length) { noAsignado[campo] += e.monto; continue; }
    for (const [a, w] of destino) porAsesor[a][campo] += e.monto * w;
  }
  return { porAsesor, noAsignado };
}

// ---------------------------------------------------------------------------
// Fechas
export function rangoAnioAnterior(desde, hasta) {
  const menos1 = (f) => {
    const [y, m, d] = f.split('-').map(Number);
    const ultimo = new Date(Date.UTC(y - 1, m, 0)).getUTCDate(); // 29-feb -> 28-feb
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
  };
  return { desde: menos1(desde), hasta: menos1(hasta) };
}

// ---------------------------------------------------------------------------
/**
 * Cálculo principal.
 * @param {{filas:object[], pool:object[]}} datos  filas agregadas por día/vendedor y pool de gastos (de la caché)
 * @param {{desde:string, hasta:string, sucursales?:string[], areas?:string[], vendedores?:string[]}} filtros
 * @param {{gastos?:object, vendedores?:object[], umbrales?:object, reglas?:object}} cfg
 */
export function calcular(datos, filtros, cfg = {}) {
  const { desde, hasta } = filtros;
  const umbrales = cfg.umbrales ?? UMBRALES_DEFECTO;
  const reglas = cfg.reglas ?? {};
  const g = cfg.gastos ?? { confirmado: false };
  const gastosPendientes = g.confirmado !== true;
  const catalogo = new Map((cfg.vendedores ?? []).map((v) => [v.codigo, v]));
  const enRango = (f) => f >= desde && f <= hasta;

  // 1. Bases por asesor (todas, sin filtrar: el total nacional y el prorrateo usan a todos)
  const bases = new Map();
  const base = (v) => {
    if (!bases.has(v)) bases.set(v, { vb: 0, dd: 0, cv: 0, nFacturas: 0, origen: {} });
    return bases.get(v);
  };
  for (const r of datos.filas ?? []) {
    if (!enRango(r.fecha)) continue;
    const desc = reglas.vb_ignorar_descuento_igual_valor_factura ? n(r.desc) - n(r.descAnomalo) : n(r.desc);
    const b = base(r.vendedor);
    b.vb += n(r.sub) + desc;
    b.dd += desc + n(r.dev);
    b.cv += n(r.costo);
    b.nFacturas += n(r.nFacturas);
    if (r.sucursal) b.origen[r.sucursal] = (b.origen[r.sucursal] ?? 0) + n(r.nFacturas);
  }

  // 2. Gastos
  let gastosAsesor = null;
  let noAsignado = null;
  if (!gastosPendientes) {
    const vn = Object.fromEntries([...bases].map(([v, b]) => [v, b.vb - b.dd]));
    const res = asignarGastos((datos.pool ?? []).filter((p) => enRango(p.fecha)), vn, g);
    gastosAsesor = res.porAsesor;
    noAsignado = { gn: r2(res.noAsignado.gn), gg: r2(res.noAsignado.gg) };
  }
  const conGastos = (v, b) => ({
    ...b,
    gn: gastosPendientes ? null : (gastosAsesor[v]?.gn ?? 0),
    gg: gastosPendientes ? null : (gastosAsesor[v]?.gg ?? 0),
  });

  // 3. Indicadores por asesor y total nacional
  const sumar = (lista) => {
    const t = { vb: 0, dd: 0, cv: 0, gn: gastosPendientes ? null : 0, gg: gastosPendientes ? null : 0, nFacturas: 0 };
    for (const x of lista) {
      t.vb += x.vb; t.dd += x.dd; t.cv += x.cv; t.nFacturas += x.nFacturas;
      if (!gastosPendientes) { t.gn += x.gn; t.gg += x.gg; }
    }
    return t;
  };
  const todos = [...bases].map(([v, b]) => ({ asesor: v, ...conGastos(v, b) }));
  const nacionalBase = sumar(todos);
  const nacional = indicadores(nacionalBase);

  // 4. Filtros (sucursal/área de vendedores.json; si no hay sucursal, ORIGEN predominante)
  const info = (v, b) => {
    const c = catalogo.get(v) ?? {};
    const origenPred = Object.entries(b.origen).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
    return { alias: c.alias || v, nombre: c.nombre || '', sucursal: c.sucursal || origenPred, area: c.area || '', activo: c.activo !== false };
  };
  const incluye = (v, i) =>
    (!filtros.vendedores?.length || filtros.vendedores.includes(v)) &&
    (!filtros.sucursales?.length || filtros.sucursales.includes(i.sucursal)) &&
    (!filtros.areas?.length || filtros.areas.includes(i.area));

  const asesores = todos
    .map((x) => ({ x, i: info(x.asesor, bases.get(x.asesor)) }))
    .filter(({ x, i }) => incluye(x.asesor, i))
    .map(({ x, i }) => {
      const ind = indicadores(x);
      return {
        asesor: x.asesor, ...i, nFacturas: x.nFacturas, ...redondear(ind),
        part: Object.fromEntries(RUBROS.map((k) => [k, div(ind[k], nacional[k])])),
        semaforo: semaforos(ind, umbrales),
      };
    })
    .sort((a, b) => b.vn - a.vn);

  const filtroBase = sumar(todos.filter((x) => asesores.some((a) => a.asesor === x.asesor)));
  const totalFiltro = indicadores(filtroBase);
  const conVentas = asesores.filter((a) => a.vn > 0).length;
  const promedio = conVentas
    ? Object.fromEntries(RUBROS.map((k) => [k, totalFiltro[k] == null ? null : r2(totalFiltro[k] / conVentas)]))
    : null;

  // 5. Por sucursal (de los asesores filtrados)
  const grupos = new Map();
  for (const a of asesores) {
    const k = a.sucursal || '(sin sucursal)';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(todos.find((t) => t.asesor === a.asesor));
  }
  const porSucursal = [...grupos].map(([sucursal, lista]) => {
    const b = sumar(lista);
    const ind = indicadores(b);
    return {
      sucursal, nAsesores: lista.length, nFacturas: b.nFacturas, ...redondear(ind),
      part: Object.fromEntries(RUBROS.map((k) => [k, div(ind[k], nacional[k])])),
      semaforo: semaforos(ind, umbrales),
    };
  }).sort((a, b) => b.vn - a.vn);

  return {
    desde, hasta,
    porSucursal,
    gastosPendientes,
    etiquetaGastos: gastosPendientes ? ETIQUETA_PENDIENTE : null,
    asesores,
    totalFiltro: { ...redondear(totalFiltro), nFacturas: filtroBase.nFacturas, semaforo: semaforos(totalFiltro, umbrales), part: Object.fromEntries(RUBROS.map((k) => [k, div(totalFiltro[k], nacional[k])])) },
    totalNacional: { ...redondear(nacional), nFacturas: nacionalBase.nFacturas, semaforo: semaforos(nacional, umbrales) },
    promedio: promedio && { ...promedio, nAsesores: conVentas },
    gastosNoAsignados: noAsignado,
  };
}

function redondear(ind) {
  const out = { ...ind };
  for (const k of RUBROS) out[k] = r2(ind[k]);
  return out;
}
