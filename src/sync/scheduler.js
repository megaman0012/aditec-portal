// Sincronizador en segundo plano — ÚNICO componente que habla con MBA3.
//
// - Historia: desde SYNC_HISTORIA_DESDE, mes a mes; los meses cerrados ya en caché no se re-consultan
//   (el mes anterior se refresca hasta el día 10 del mes en curso por ajustes tardíos).
// - Mes en curso: cada SYNC_MES_ACTUAL_MIN minutos.
// - Caché atómica: data/cache/<tabla>/<AAAA-MM>.json (archivo temporal + rename).
// - Estado: data/estado-sync.json (lo leerá la web).
// - Si el cliente se detiene por respuestas raras repetidas: se escribe data/SYNC_DETENIDO.json, se
//   avisa en el log y NO se reintenta hasta que un humano lo reanude (scripts/sync-manual.js --reanudar).

import fs from 'node:fs';
import path from 'node:path';
import { Mba3Client } from '../mba3/client.js';
import { consultarRango, mesesEntre, rangoDeMes } from '../mba3/queries.js';

const MAX_ERRORES_GUARDADOS = 20;
const DIA_LIMITE_MES_ANTERIOR = 10;

export function escribirJsonAtomico(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

function leerJson(file, def = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}

// Fecha de hoy 'AAAA-MM-DD' en la zona horaria del negocio.
export function hoyEn(tz, ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

export function rutasCache(dataDir) {
  return {
    cache: (tabla, mes) => path.join(dataDir, 'cache', tabla, `${mes}.json`),
    estado: path.join(dataDir, 'estado-sync.json'),
    detenido: path.join(dataDir, 'SYNC_DETENIDO.json'),
  };
}

// Tablas a sincronizar: asientos solo cuando Fase 4 defina las cuentas de gasto.
export function tablasActivas(cfg) {
  const t = ['facturas', 'movimientos'];
  const g = cfg.gastos ?? {};
  if ((g.nomina?.length ?? 0) + (g.generales?.length ?? 0) > 0) t.push('asientos');
  return t;
}

/**
 * Decide qué meses consultar en una pasada.
 * - Meses sin caché (historia pendiente).
 * - El mes en curso siempre.
 * - El mes anterior si hoy es día <= 10.
 */
export function mesesPendientes({ historiaDesde, hoy, existe }) {
  const mesActual = hoy.slice(0, 7);
  const todos = mesesEntre(historiaDesde, hoy);
  const anterior = todos.at(-2);
  const dia = Number(hoy.slice(8, 10));
  return todos.filter((mes) => mes === mesActual || (mes === anterior && dia <= DIA_LIMITE_MES_ANTERIOR) || !existe(mes));
}

export function crearSincronizador(cfg, { log = console, crearCliente } = {}) {
  const rutas = rutasCache(cfg.dataDir);
  let timer = null;
  let corriendo = false;
  let parado = false;
  let cliente = null;

  const estado = leerJson(rutas.estado, null) ?? {
    estado: 'nuevo',
    ultimaPasadaInicio: null,
    ultimaPasadaFin: null,
    ultimaPasadaOk: null,
    meses: {},
    errores: [],
  };

  function guardarEstado(cambios = {}) {
    Object.assign(estado, cambios, { actualizado: new Date().toISOString() });
    try { escribirJsonAtomico(rutas.estado, estado); } catch (e) { log.error('[sync] no se pudo guardar estado:', e.message); }
  }

  function registrarError(msg) {
    estado.errores = [{ t: new Date().toISOString(), msg }, ...(estado.errores ?? [])].slice(0, MAX_ERRORES_GUARDADOS);
  }

  function marcarDetenido(motivo) {
    escribirJsonAtomico(rutas.detenido, { desde: new Date().toISOString(), motivo });
    guardarEstado({ estado: 'detenido', motivo });
    log.error('[sync] ======================================================');
    log.error('[sync] SINCRONIZADOR DETENIDO:', motivo);
    log.error('[sync] Revisar MBA3 > Servicios de Acceso Externo > IPs y luego:');
    log.error('[sync]   docker compose exec portal node scripts/sync-manual.js --reanudar');
    log.error('[sync] ======================================================');
    detener();
  }

  function obtenerCliente() {
    if (cliente) return cliente;
    const opciones = {
      base: cfg.mba3.base,
      codigo: cfg.mba3.codigo,
      pwd: cfg.mba3.pwd,
      pausaMs: cfg.mba3.pausaMs,
      renovarMs: cfg.mba3.renovarMs,
      dataDir: cfg.dataDir,
      alEvento: (e) => {
        if (e.tipo === 'respuesta-rara') log.warn(`[sync] respuesta rara ${e.n}/3: ${e.detalle}`);
        if (e.tipo === 'reintento-unauthorized') log.warn(`[sync] Unauthorized en ${e.from}: renovando sesión y reintentando 1 vez`);
      },
    };
    cliente = crearCliente ? crearCliente(opciones) : new Mba3Client(opciones);
    return cliente;
  }

  /**
   * Una pasada de sincronización (serial). Si se pasan desde/hasta, sincroniza esos meses aunque
   * ya estén en caché (uso manual).
   */
  async function pasada({ desde, hasta, tablas } = {}) {
    if (corriendo) return { omitida: 'ya hay una pasada en curso' };
    if (fs.existsSync(rutas.detenido)) return { omitida: 'sincronizador detenido (SYNC_DETENIDO.json)' };
    corriendo = true;
    const c = obtenerCliente();
    const hoy = hoyEn(cfg.tz);
    const lista = tablas ?? tablasActivas(cfg);
    const meses = desde
      ? mesesEntre(desde, hasta ?? hoy)
      : mesesPendientes({ historiaDesde: cfg.sync.historiaDesde, hoy, existe: (mes) => lista.every((t) => fs.existsSync(rutas.cache(t, mes))) });
    const resumen = { meses: meses.length, consultas: 0, filas: 0, errores: 0 };
    guardarEstado({ estado: 'sincronizando', ultimaPasadaInicio: new Date().toISOString() });
    log.log(`[sync] pasada: ${meses.length} mes(es) × ${lista.length} tabla(s) [${lista.join(', ')}]`);

    try {
      c.tomarLock('sincronizador');
      for (const mes of meses) {
        for (const tabla of lista) {
          if (parado) break;
          const r = rangoDeMes(mes);
          const hasta2 = r.hasta > hoy ? hoy : r.hasta;
          try {
            const filas = await consultarRango(c, {
              tabla, empresa: cfg.mba3.empresa, desde: r.desde, hasta: hasta2, limit: cfg.mba3.limit,
              alPartir: (p) => log.log(`[sync] ${tabla} ${p.desde}..${p.hasta} llegó al límite; partiendo en ${p.mitad}`),
            });
            escribirJsonAtomico(rutas.cache(tabla, mes), {
              tabla, mes, desde: r.desde, hasta: hasta2, sincronizado: new Date().toISOString(), filas,
            });
            estado.meses[`${tabla}:${mes}`] = { filas: filas.length, sincronizado: new Date().toISOString() };
            resumen.consultas++;
            resumen.filas += filas.length;
            log.log(`[sync] ${tabla} ${mes}: ${filas.length} filas`);
          } catch (e) {
            resumen.errores++;
            registrarError(`${tabla} ${mes}: ${e.message}`);
            log.error(`[sync] ${tabla} ${mes}: ${e.message}`);
            if (c.detenido) {
              marcarDetenido(c.motivoDetencion);
              return { ...resumen, detenido: true };
            }
            if (e.tipo === 'lock') throw e;
          }
          guardarEstado();
        }
      }
      guardarEstado({
        estado: resumen.errores ? 'con-errores' : 'ok',
        ultimaPasadaFin: new Date().toISOString(),
        ...(resumen.errores ? {} : { ultimaPasadaOk: new Date().toISOString() }),
      });
      log.log(`[sync] pasada terminada: ${JSON.stringify(resumen)} · peticiones MBA3 acumuladas: ${c.peticiones}`);
      return resumen;
    } catch (e) {
      registrarError(e.message);
      guardarEstado({ estado: 'error', ultimaPasadaFin: new Date().toISOString() });
      log.error('[sync] pasada abortada:', e.message);
      return { ...resumen, error: e.message };
    } finally {
      c.soltarLock();
      corriendo = false;
    }
  }

  function programar() {
    if (parado) return;
    timer = setTimeout(async () => {
      await pasada();
      programar();
    }, cfg.sync.mesActualMin * 60_000);
    timer.unref?.();
  }

  function iniciar() {
    if (!cfg.sync.activo) {
      guardarEstado({ estado: 'deshabilitado' });
      log.log('[sync] deshabilitado (SYNC_ACTIVO != true)');
      return false;
    }
    if (!cfg.mba3.codigo || !cfg.mba3.pwd) {
      guardarEstado({ estado: 'sin-credenciales' });
      log.warn('[sync] sin credenciales MBA3: no se inicia');
      return false;
    }
    if (fs.existsSync(rutas.detenido)) {
      const d = leerJson(rutas.detenido, {});
      guardarEstado({ estado: 'detenido', motivo: d.motivo });
      log.error('[sync] sigue DETENIDO desde', d.desde, '-', d.motivo);
      return false;
    }
    parado = false;
    log.log(`[sync] iniciado: historia desde ${cfg.sync.historiaDesde}, mes en curso cada ${cfg.sync.mesActualMin} min`);
    // Primera pasada poco después de arrancar (no bloquea el servidor web).
    timer = setTimeout(async () => {
      await pasada();
      programar();
    }, 5_000);
    timer.unref?.();
    return true;
  }

  function detener() {
    parado = true;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { iniciar, detener, pasada, estado: () => ({ ...estado }), rutas };
}

export function reanudar(dataDir) {
  const { detenido } = rutasCache(dataDir);
  if (!fs.existsSync(detenido)) return false;
  fs.unlinkSync(detenido);
  return true;
}
