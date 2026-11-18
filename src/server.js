// Punto de entrada del Portal ADITEC.
import { config, validar, describe } from './config.js';
import { crearSincronizador } from './sync/scheduler.js';
import { crearApp, VERSION } from './app.js';

const { errores, avisos } = validar(config);
for (const a of avisos) console.warn('[config] AVISO:', a);
if (errores.length) {
  for (const e of errores) console.error('[config] ERROR:', e);
  process.exit(1);
}

// Sincronizador: corre en segundo plano, independiente de las peticiones web.
const sincronizador = crearSincronizador(config);
const server = crearApp(config, { sync: sincronizador });

server.listen(config.port, () => {
  console.log(`[aditec-portal] v${VERSION} escuchando en :${config.port}`);
  console.log('[aditec-portal] config:', JSON.stringify(describe(config)));
  sincronizador.iniciar();
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[aditec-portal] ${sig} recibido, cerrando...`);
    sincronizador.detener();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
