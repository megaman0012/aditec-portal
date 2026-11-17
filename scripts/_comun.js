// Utilidades compartidas por los scripts. Todos usan el cliente con cola serial + lock.
import { config, validar } from '../src/config.js';
import fs from 'node:fs';
import { Mba3Client } from '../src/mba3/client.js';
import { rutasCache, escribirJsonAtomico } from '../src/sync/scheduler.js';

export { config };

export function crearCliente(dueno) {
  const flag = rutasCache(config.dataDir).detenido;
  if (fs.existsSync(flag) && !process.argv.includes('--forzar')) {
    const d = JSON.parse(fs.readFileSync(flag, 'utf8'));
    salir(`MBA3 marcado como DETENIDO desde ${d.desde}: ${d.motivo}\n` +
      'Resuelve la causa y ejecuta: node scripts/sync-manual.js --reanudar  (o añade --forzar bajo tu responsabilidad)');
  }
  const { errores } = validar(config);
  if (errores.length) salir(`Config inválida:\n - ${errores.join('\n - ')}`);
  if (!config.mba3.codigo || !config.mba3.pwd) salir('Faltan MBA3_CODIGO / MBA3_PWD en .env');
  const c = new Mba3Client({
    base: config.mba3.base,
    codigo: config.mba3.codigo,
    pwd: config.mba3.pwd,
    pausaMs: config.mba3.pausaMs,
    renovarMs: config.mba3.renovarMs,
    dataDir: config.dataDir,
    alEvento: (e) => {
      if (e.tipo === 'login') console.log(`  · login OK (${e.ms} ms) — jwt recibido, no se muestra`);
      if (e.tipo === 'consulta') console.log(`  · ${e.from}: ${e.filas} fila(s)${e.vacio ? ' [009 = vacío]' : ''} (${e.ms} ms)`);
      if (e.tipo === 'respuesta-rara') console.warn(`  ! respuesta rara ${e.n}/3: ${e.detalle}`);
      if (e.tipo === 'reintento-unauthorized') console.warn('  ! Unauthorized: renovando sesión y reintentando 1 vez');
      if (e.tipo === 'detenido') {
        console.error(`  ✖ DETENIDO: ${e.motivo}`);
        escribirJsonAtomico(flag, { desde: new Date().toISOString(), motivo: e.motivo, origen: dueno });
      }
    },
  });
  c.tomarLock(dueno);
  const soltar = () => c.soltarLock();
  process.on('exit', soltar);
  process.on('SIGINT', () => { soltar(); process.exit(130); });
  return c;
}

export function salir(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

export function args() {
  const out = { _: [] };
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] ?? true;
    else out._.push(a);
  }
  return out;
}

// Describe columnas y tipos de una muestra de filas.
export function describirColumnas(filas) {
  const cols = {};
  for (const f of filas) {
    for (const [k, v] of Object.entries(f)) {
      const t = v === null ? 'null' : typeof v;
      (cols[k] ??= new Set()).add(t);
    }
  }
  return Object.fromEntries(Object.entries(cols).map(([k, s]) => [k, [...s].join('|')]));
}
