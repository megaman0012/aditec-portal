#!/usr/bin/env node
// Sincronización manual por meses, o reanudación tras una detención.
// Uso:
//   docker compose exec portal node scripts/sync-manual.js --mes=2026-10            (recargar un mes)
//   docker compose exec portal node scripts/sync-manual.js --desde=2026-01 --hasta=2026-10
//   docker compose exec portal node scripts/sync-manual.js --pendientes             (plan automático)
//   docker compose exec portal node scripts/sync-manual.js --estado
//   docker compose exec portal node scripts/sync-manual.js --reanudar               (borra SYNC_DETENIDO.json)
// Opcional: --crudo  guarda además las filas crudas en data/exploracion/crudo/ (para analizar-mes.js)
import { config, args, salir } from './_comun.js';
import { crearSincronizador, reanudar } from '../src/sync/scheduler.js';
import { mesesEntre } from '../src/mba3/queries.js';

const a = args();
const MES = /^\d{4}-\d{2}$/;

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

let meses;
if (a.mes) {
  if (!MES.test(a.mes)) salir('--mes=AAAA-MM');
  meses = [a.mes];
} else if (a.desde) {
  const hasta = a.hasta ?? a.desde;
  if (!MES.test(a.desde) || !MES.test(hasta)) salir('--desde=AAAA-MM [--hasta=AAAA-MM]');
  meses = mesesEntre(`${a.desde}-01`, `${hasta}-01`).reverse(); // más reciente primero
} else if (!a.pendientes) {
  salir('Indica --mes=AAAA-MM, --desde=AAAA-MM [--hasta=AAAA-MM] o --pendientes');
}

const r = await sync.pasada({ meses, guardarCrudo: !!a.crudo });
console.log('Resumen:', JSON.stringify(r));
process.exit(r.error || r.detenido || r.omitida || r.errores ? 1 : 0);
