#!/usr/bin/env node
// Sincronización manual (una pasada) o reanudación tras una detención.
// Uso:
//   docker compose exec portal node scripts/sync-manual.js --desde=2026-10-01 --hasta=2026-10-31 [--tablas=facturas,movimientos]
//   docker compose exec portal node scripts/sync-manual.js --pendientes      (lo mismo que haría el sincronizador)
//   docker compose exec portal node scripts/sync-manual.js --estado
//   docker compose exec portal node scripts/sync-manual.js --reanudar        (borra SYNC_DETENIDO.json)
import { config, args, salir } from './_comun.js';
import { crearSincronizador, reanudar } from '../src/sync/scheduler.js';
import { TABLAS, validarFecha } from '../src/mba3/queries.js';

const a = args();

if (a.reanudar) {
  console.log(reanudar(config.dataDir) ? 'Sincronizador reanudado (reinicia el contenedor para que retome).' : 'No estaba detenido.');
  process.exit(0);
}

const sync = crearSincronizador(config);

if (a.estado) {
  console.log(JSON.stringify(sync.estado(), null, 2));
  process.exit(0);
}

if (!config.mba3.codigo || !config.mba3.pwd) salir('Faltan MBA3_CODIGO / MBA3_PWD en .env');

let opciones = {};
if (!a.pendientes) {
  if (!a.desde) salir('Indica --desde=AAAA-MM-DD [--hasta=AAAA-MM-DD] o --pendientes');
  try {
    validarFecha(a.desde);
    if (a.hasta) validarFecha(a.hasta);
  } catch (e) { salir(e.message); }
  opciones = { desde: a.desde, hasta: a.hasta };
}
if (a.tablas) {
  const tablas = String(a.tablas).split(',').map((s) => s.trim());
  for (const t of tablas) if (!TABLAS[t]) salir(`Tabla desconocida: ${t} (usa: ${Object.keys(TABLAS).join(', ')})`);
  opciones.tablas = tablas;
}

const r = await sync.pasada(opciones);
console.log('Resumen:', JSON.stringify(r));
process.exit(r.error || r.detenido || r.omitida ? 1 : 0);
