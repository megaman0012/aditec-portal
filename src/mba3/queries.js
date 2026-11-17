// Consultas por tabla y rango de fechas. Filtros ORDA:
// operadores = != < > <= >= AND OR; NO <> ni {d '...'}; fechas como texto 'AAAA-MM-DD'.
//
// Si una consulta devuelve exactamente `limit` filas puede estar truncada: el rango se parte en
// dos y se consulta cada mitad (en serie, nunca en paralelo).

export const TABLAS = {
  facturas: {
    from: 'CLNT_Factura_Principal',
    campoFecha: 'FECHA_FACTURA',
    select: [
      'EMPRESA', 'ANIO', 'MES', 'FECHA_FACTURA', 'VENDEDOR', 'ORIGEN', 'TIPO_DOCUMENTO',
      'SUBTOTAL_CON_IVA', 'SUBTOTAL_SIN_IVA', 'VALOR_FACTURA', 'VALOR_TOTAL_DESCUENTO',
      'TOTAL_DEVOLUCION', 'ANULADA',
    ],
    filtroBase: (empresa) => `EMPRESA = '${empresa}' AND TIPO_DOCUMENTO = 'FACT'`,
  },
  movimientos: {
    from: 'INVT_Producto_Movimientos',
    campoFecha: 'TRANS_DATE',
    select: [
      'CORP', 'COD_SALESMAN', 'ADJUSTMENT_TYPE', 'TRANS_DATE', 'QUANTITY', 'TOT_RETURN_UNIT',
      'TRANS_COST', 'NET_LINE_TOTAL', 'Anulada',
    ],
    filtroBase: (empresa) => `CORP = '${empresa}' AND ADJUSTMENT_TYPE = 'FT'`,
  },
  asientos: {
    from: 'CONT_Asiento_Detalle',
    campoFecha: 'POST_TO_DATE',
    select: [
      'GL_ACCOUNT_CODE', 'DEBIT_AMOUNT', 'CREDIT_AMOUNT', 'DEPARTMENT_CODE', 'PROFIT_CENTER_CODE',
      'POST_TO_DATE', 'ORIGIN',
    ],
    // Las cuentas a traer se definen en Fase 4 (config/gastos.json).
    filtroBase: () => '',
  },
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const VALOR_SEGURO = /^[A-Za-z0-9._-]+$/;

export function validarFecha(f) {
  if (!FECHA.test(f) || Number.isNaN(Date.parse(f + 'T00:00:00Z'))) throw new Error(`Fecha inválida: ${f}`);
  return f;
}

export function whereRango(tabla, empresa, desde, hasta) {
  const t = TABLAS[tabla];
  if (!t) throw new Error(`Tabla desconocida: ${tabla}`);
  if (!VALOR_SEGURO.test(empresa)) throw new Error('Empresa inválida');
  validarFecha(desde);
  validarFecha(hasta);
  const partes = [];
  const base = t.filtroBase(empresa);
  if (base) partes.push(base);
  partes.push(`${t.campoFecha} >= '${desde}'`, `${t.campoFecha} <= '${hasta}'`);
  return partes.join(' AND ');
}

// Utilidades de fechas (UTC, sin zonas horarias: solo días calendario).
const aDate = (f) => new Date(f + 'T00:00:00Z');
const aTexto = (d) => d.toISOString().slice(0, 10);
export function sumarDias(f, n) {
  const d = aDate(f);
  d.setUTCDate(d.getUTCDate() + n);
  return aTexto(d);
}
export function diasEntre(desde, hasta) {
  return Math.round((aDate(hasta) - aDate(desde)) / 86_400_000);
}

// Meses 'AAAA-MM' entre dos fechas (incluidos).
export function mesesEntre(desde, hasta) {
  const out = [];
  let [y, m] = desde.slice(0, 7).split('-').map(Number);
  const [yh, mh] = hasta.slice(0, 7).split('-').map(Number);
  while (y < yh || (y === yh && m <= mh)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export function rangoDeMes(mes) {
  const [y, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

/**
 * Trae todas las filas de una tabla en un rango, partiendo el rango si llega al límite.
 * Siempre en serie (await dentro del bucle), nunca en paralelo.
 */
export async function consultarRango(cliente, { tabla, empresa, desde, hasta, limit, alPartir = () => {} }) {
  const t = TABLAS[tabla];
  const filas = await cliente.consultar({
    select: t.select.join(','),
    from: t.from,
    where: whereRango(tabla, empresa, desde, hasta),
    limit,
  });
  if (filas.length < limit) return filas;

  const dias = diasEntre(desde, hasta);
  if (dias < 1) {
    throw new Error(`${t.from} ${desde}: un solo día supera MBA3_LIMIT=${limit}; súbelo en .env`);
  }
  const mitad = sumarDias(desde, Math.floor(dias / 2));
  alPartir({ tabla, desde, hasta, mitad });
  const a = await consultarRango(cliente, { tabla, empresa, desde, hasta: mitad, limit, alPartir });
  const b = await consultarRango(cliente, { tabla, empresa, desde: sumarDias(mitad, 1), hasta, limit, alPartir });
  return a.concat(b);
}
