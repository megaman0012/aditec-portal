// Sincronizador en segundo plano — ÚNICO componente que habla con MBA3.
//
// Unidad = MES. Por cada mes se consultan (en serie) facturas, movimientos y asientos, se AGREGAN
// por vendedor/día (src/calc/agregar.js) y se escribe data/cache/AAAA-MM.json de forma atómica.
// No se guardan filas crudas (salvo `guardarCrudo` para exploración, en data/exploracion/crudo/).
//
// - Mes en curso: se refresca en cada pasada (cada SYNC_MES_ACTUAL_MIN minutos).
// - Meses cerrados: se descargan una vez y quedan fijos; "recargar mes" fuerza una nueva descarga.
// - Historia faltante desde SYNC_HISTORIA_DESDE: de lo más reciente a lo más antiguo.
// - Estado: data/estado.json (último sync por mes, peticiones, errores, duración).
// - Respuestas raras repetidas o IP no autorizada: data/SYNC_DETENIDO.json y no se vuelve a llamar
//   a MBA3 hasta `scripts/sync-manual.js --reanudar`.

import fs from 'node:fs';
import path from 'node:path';
import { Mba3Client } from '../mba3/client.js';
import { consultarRango, mesesEntre, rangoDeMes } from '../mba3/queries.js';
import { agregarMes } from '../calc/agregar.js';

const MAX_ERRORES_GUARDADOS = 30;
const VERSION_CACHE = 1;
export const TABLAS_MES = ['facturas', 'movimientos', 'asientos'];

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
    mes: (mes) => path.join(dataDir, 'cache', `${mes}.json`),
    crudo: (tabla, mes) => path.join(dataDir, 'exploracion', 'crudo', `${tabla}-${mes}.json`),
    estado: path.join(dataDir, 'estado.json'),
    detenido: path.join(dataDir, 'SYNC_DETENIDO.json'),
  };
}

/**
 * Plan de una pasada automática: primero el mes en curso, luego los meses cerrados que falten,
 * del más reciente al más antiguo.
 */
export function planDePasada({ historiaDesde, hoy, existe }) {
  const mesActual = hoy.slice(0, 7);
  const cerradosFaltantes = mesesEntre(historiaDesde, hoy)
    .filter((m) => m !== mesActual && !existe(m))
    .reverse();
  return [mesActual, ...cerradosFaltantes];
}

export function crearSincronizador(cfg, { log = console, crearCliente } = {}) {
  const rutas = rutasCache(cfg.dataDir);
  let timer = null;
  let corriendo = false;
  let parado = false;
  let cliente = null;

  const estado = leerJson(rutas.estado, null) ?? {
    estado: 'nuevo', peticionesTotales: 0, meses: {}, errores: [], ultimaPasada: null,
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
      base: cfg.mba3.base, codigo: cfg.mba3.codigo, pwd: cfg.mba3.pwd,
      pausaMs: cfg.mba3.pausaMs, renovarMs: cfg.mba3.renovarMs, dataDir: cfg.dataDir,
      alEvento: (e) => {
        if (e.tipo === 'respuesta-rara') log.warn(`[sync] respuesta rara ${e.n}/3: ${e.detalle}`);
        if (e.tipo === 'reintento-unauthorized') log.warn(`[sync] Unauthorized en ${e.from}: renovando sesión y reintentando 1 vez`);
      },
    };
    cliente = crearCliente ? crearCliente(opciones) : new Mba3Client(opciones);
    return cliente;
  }

  // Descarga y agrega UN mes. Lanza si falla alguna tabla (el archivo anterior, si existe, se conserva).
  async function sincronizarMes(c, mes, hoy, { guardarCrudo = false } = {}) {
    const t0 = Date.now();
    const p0 = c.peticiones;
    const r = rangoDeMes(mes);
    const hasta = r.hasta > hoy ? hoy : r.hasta;
    const crudo = {};
    for (const tabla of TABLAS_MES) {
      crudo[tabla] = await consultarRango(c, {
        tabla, empresa: cfg.mba3.empresa, desde: r.desde, hasta, limit: cfg.mba3.limit,
        alPartir: (p) => log.log(`[sync]   ${tabla} ${p.desde}..${p.hasta} llegó al tope; partiendo en ${p.mitad}`),
      });
      if (guardarCrudo) escribirJsonAtomico(rutas.crudo(tabla, mes), { tabla, mes, filas: crudo[tabla] });
    }
    const agg = agregarMes({ mes, ...crudo });
    const mesActual = hoy.slice(0, 7);
    const info = {
      version: VERSION_CACHE,
      mes, desde: r.desde, hasta,
      cerrado: mes < mesActual,
      generado: new Date().toISOString(),
      peticiones: c.peticiones - p0,
      duracionMs: Date.now() - t0,
      conteo: agg.conteo,
      descartes: agg.descartes,
    };
    escribirJsonAtomico(rutas.mes(mes), { ...info, cuentas: agg.cuentas, filas: agg.filas, pool: agg.pool });
    return info;
  }

  /**
   * Una pasada (serial).
   * @param {{meses?:string[]}} [o]  meses explícitos (recargar/forzar). Sin meses: plan automático.
   */
  async function pasada({ meses, guardarCrudo = false } = {}) {
    if (corriendo) return { omitida: 'ya hay una pasada en curso' };
    if (fs.existsSync(rutas.detenido)) return { omitida: 'sincronizador detenido (SYNC_DETENIDO.json)' };
    corriendo = true;
    const c = obtenerCliente();
    const hoy = hoyEn(cfg.tz);
    const plan = meses ?? planDePasada({ historiaDesde: cfg.sync.historiaDesde, hoy, existe: (m) => fs.existsSync(rutas.mes(m)) });
    const t0 = Date.now();
    const p0 = c.peticiones;
    const resumen = { meses: plan.length, ok: 0, errores: 0, peticiones: 0, duracionMs: 0 };
    guardarEstado({ estado: 'sincronizando', pasadaInicio: new Date().toISOString(), plan });
    log.log(`[sync] pasada: ${plan.length} mes(es): ${plan.join(', ')}`);

    try {
      c.tomarLock('sincronizador');
      for (const mes of plan) {
        if (parado) break;
        try {
          const info = await sincronizarMes(c, mes, hoy, { guardarCrudo });
          estado.meses[mes] = { ...info, error: null };
          estado.peticionesTotales = (estado.peticionesTotales ?? 0) + info.peticiones;
          resumen.ok++;
          log.log(`[sync] ${mes}: ${info.conteo.facturas} fact · ${info.conteo.movimientos} mov · ${info.conteo.asientos} asientos · ${info.peticiones} peticiones · ${(info.duracionMs / 1000).toFixed(1)} s`);
        } catch (e) {
          resumen.errores++;
          estado.meses[mes] = { ...(estado.meses[mes] ?? {}), error: e.message, errorEn: new Date().toISOString() };
          registrarError(`${mes}: ${e.message}`);
          log.error(`[sync] ${mes}: ${e.message}`);
          if (c.detenido) {
            marcarDetenido(c.motivoDetencion);
            return { ...resumen, detenido: true };
          }
          if (e.tipo === 'lock') throw e;
        }
        guardarEstado();
      }
      resumen.peticiones = c.peticiones - p0;
      resumen.duracionMs = Date.now() - t0;
      guardarEstado({
        estado: resumen.errores ? 'con-errores' : 'ok',
        ultimaPasada: { fin: new Date().toISOString(), ...resumen },
      });
      log.log(`[sync] pasada terminada: ${JSON.stringify(resumen)}`);
      return resumen;
    } catch (e) {
      registrarError(e.message);
      guardarEstado({ estado: 'error' });
      log.error('[sync] pasada abortada:', e.message);
      return { ...resumen, error: e.message };
    } finally {
      c.soltarLock();
      corriendo = false;
    }
  }

  // Botón admin "recargar mes" (Fase 6 lo expone en la web).
  function recargarMes(mes) {
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes inválido');
    return pasada({ meses: [mes] });
  }

  function programar(ms) {
    if (parado) return;
    timer = setTimeout(async () => {
      await pasada();
      programar(cfg.sync.mesActualMin * 60_000);
    }, ms);
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
    programar(5_000); // primera pasada poco después de arrancar (no bloquea la web)
    return true;
  }

  function detener() {
    parado = true;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { iniciar, detener, pasada, recargarMes, estado: () => ({ ...estado }), rutas, ocupado: () => corriendo };
}

export function reanudar(dataDir) {
  const { detenido } = rutasCache(dataDir);
  if (!fs.existsSync(detenido)) return false;
  fs.unlinkSync(detenido);
  return true;
}
