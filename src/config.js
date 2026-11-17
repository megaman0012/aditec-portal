// Configuración: variables de entorno (.env vía docker compose) + config/*.json.
// Se valida al arrancar. Nunca registrar secretos: usar describe() para logs.

import fs from 'node:fs';
import path from 'node:path';

const PAUSA_MINIMA_MS = 1500; // piso duro anti-veto de IP

function int(env, name, def) {
  const v = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
}

function leerJson(dir, nombre, def) {
  const file = path.join(dir, nombre);
  if (!fs.existsSync(file)) return def;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`config/${nombre} no es JSON válido: ${err.message}`);
  }
}

export function cargarConfig(env = process.env) {
  const configDir = env.CONFIG_DIR || new URL('../config/', import.meta.url).pathname;
  const cfg = {
    port: int(env, 'PORT', 8090),
    tz: env.TZ || 'America/Guayaquil',
    dataDir: env.DATA_DIR || new URL('../data/', import.meta.url).pathname,
    configDir,
    publicDir: env.PUBLIC_DIR || new URL('../public/', import.meta.url).pathname,
    session: {
      secret: env.SESSION_SECRET || '',
      horas: int(env, 'SESSION_HORAS', 8),
    },
    mba3: {
      base: (env.MBA3_BASE || 'http://192.168.1.203:8081').replace(/\/+$/, ''),
      codigo: env.MBA3_CODIGO || '',
      pwd: env.MBA3_PWD || '',
      empresa: env.MBA3_EMPRESA || 'ADITE',
      pausaMs: Math.max(PAUSA_MINIMA_MS, int(env, 'MBA3_PAUSA_MS', PAUSA_MINIMA_MS)),
      renovarMs: int(env, 'MBA3_RENOVAR_MIN', 8) * 60_000,
      limit: int(env, 'MBA3_LIMIT', 5000),
    },
    sync: {
      // Interruptor general: el sincronizador solo arranca con SYNC_ACTIVO=true.
      activo: String(env.SYNC_ACTIVO ?? '').toLowerCase() === 'true',
      mesActualMin: int(env, 'SYNC_MES_ACTUAL_MIN', 30),
      historiaDesde: env.SYNC_HISTORIA_DESDE || '2025-01-01',
    },
    vendedores: leerJson(configDir, 'vendedores.json', { vendedores: [] }),
    gastos: leerJson(configDir, 'gastos.json', { nomina: [], generales: [] }),
  };
  return cfg;
}

// Devuelve { errores, avisos }. Errores impiden arrancar; avisos dejan el portal en modo solo-caché.
export function validar(cfg) {
  const errores = [];
  const avisos = [];
  if (cfg.session.secret.length < 32) errores.push('SESSION_SECRET falta o es corto (usa: openssl rand -hex 32)');
  if (!/^https?:\/\/[^/]+$/.test(cfg.mba3.base)) errores.push('MBA3_BASE inválida');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.sync.historiaDesde)) errores.push('SYNC_HISTORIA_DESDE debe ser AAAA-MM-DD');
  if (cfg.mba3.renovarMs <= 0 || cfg.mba3.renovarMs >= 10 * 60_000) errores.push('MBA3_RENOVAR_MIN debe estar entre 1 y 9');
  if (cfg.mba3.limit < 1) errores.push('MBA3_LIMIT debe ser > 0');
  if (cfg.sync.mesActualMin < 5) errores.push('SYNC_MES_ACTUAL_MIN mínimo 5');
  if (!cfg.mba3.codigo || !cfg.mba3.pwd) avisos.push('MBA3_CODIGO/MBA3_PWD vacíos: sincronizador deshabilitado');
  if (!Array.isArray(cfg.vendedores.vendedores)) errores.push('config/vendedores.json: falta arreglo "vendedores"');
  return { errores, avisos };
}

// Resumen seguro para logs (sin secretos).
export function describe(cfg) {
  return {
    port: cfg.port,
    tz: cfg.tz,
    session: { secret: cfg.session.secret ? 'definido' : 'FALTA', horas: cfg.session.horas },
    mba3: {
      base: cfg.mba3.base,
      codigo: cfg.mba3.codigo ? 'definido' : 'FALTA',
      pwd: cfg.mba3.pwd ? 'definido' : 'FALTA',
      empresa: cfg.mba3.empresa,
      pausaMs: cfg.mba3.pausaMs,
      renovarMs: cfg.mba3.renovarMs,
      limit: cfg.mba3.limit,
    },
    sync: cfg.sync,
    vendedores: cfg.vendedores.vendedores?.length ?? 0,
  };
}

export const config = cargarConfig();
