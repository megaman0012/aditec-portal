#!/usr/bin/env node
// MODO DEV: portal completo contra el SIMULADOR de MBA3 con datos sintéticos (nunca toca MBA3 real).
//
//  1. Genera datos ficticios (asesores, facturas, costos, nómina y gastos) desde 2025-01 hasta hoy.
//  2. Levanta test/mock-mba3.js con esos datos.
//  3. Sincroniza TODOS los meses a través del cliente real (cola serial, partición de rangos).
//  4. Crea config y usuario de desarrollo y levanta el portal en el puerto DEV_PORT (8091).
//
// Uso (desde la carpeta del proyecto):
//   docker run --rm -it -p 127.0.0.1:8091:8091 -v "$PWD":/app:Z -w /app node:20-alpine node scripts/dev.js
//   -> http://localhost:8091  usuario: dev  clave: DEV_PASSWORD (por defecto "desarrollo-123")
// Opciones de entorno: DEV_PORT, DEV_PASSWORD, DEV_GASTOS_CONFIRMADOS=false (para ver "Pendiente de configurar").
process.env.NODE_ENV = 'test'; // permite pausas cortas SOLO contra el simulador

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { iniciarMock } from '../test/mock-mba3.js';
import { Mba3Client } from '../src/mba3/client.js';
import { crearSincronizador, hoyEn } from '../src/sync/scheduler.js';
import { crearApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import { mesesEntre, rangoDeMes } from '../src/mba3/queries.js';
import { UMBRALES_DEFECTO } from '../src/calc/metrics.js';

const PUERTO = Number(process.env.DEV_PORT || 8091);
const CLAVE = process.env.DEV_PASSWORD || 'desarrollo-123';
const GASTOS_OK = process.env.DEV_GASTOS_CONFIRMADOS !== 'false';
const TZ = 'America/Guayaquil';
const DESDE = '2025-01-01';

// ---------------------------------------------------------------- datos sintéticos (deterministas)
function prng(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = prng(20261118);
const entre = (a, b) => a + rnd() * (b - a);
const r2 = (x) => Math.round(x * 100) / 100;

const ASESORES = [
  { codigo: 'DV-AN', alias: 'ANDR', nombre: 'Asesor Andino', sucursal: 'Quito', area: 'Comercial', origen: 'UIO', dep: '2', peso: 1.6 },
  { codigo: 'DV-BR', alias: 'BRIS', nombre: 'Asesora Brisa', sucursal: 'Quito', area: 'Comercial', origen: 'UIO', dep: '2', peso: 1.2 },
  { codigo: 'DV-CU', alias: 'CUMB', nombre: 'Asesor Cumbre', sucursal: 'Quito', area: 'Técnica', origen: 'UIO', dep: '2', peso: 0.7 },
  { codigo: 'DV-DE', alias: 'DELT', nombre: 'Asesora Delta', sucursal: 'Guayaquil', area: 'Comercial', origen: 'PRI', dep: '1', peso: 2.0 },
  { codigo: 'DV-ES', alias: 'ESTE', nombre: 'Asesor Estero', sucursal: 'Guayaquil', area: 'Comercial', origen: 'PRI', dep: '1', peso: 1.4 },
  { codigo: 'DV-FA', alias: 'FARO', nombre: 'Asesora Faro', sucursal: 'Guayaquil', area: 'Técnica', origen: 'PRI', dep: '1', peso: 0.9 },
  { codigo: 'DV-GO', alias: 'GOLF', nombre: 'Asesor Golfo', sucursal: 'Guayaquil', area: 'Comercial', origen: 'PRI', dep: '1', peso: 1.1 },
  { codigo: 'DV-HU', alias: 'HUAN', nombre: 'Asesora Huancavilca', sucursal: 'Cuenca', area: 'Comercial', origen: 'CUE', dep: '3', peso: 0.8 },
  { codigo: 'DV-IN', alias: 'INTI', nombre: 'Asesor Inti', sucursal: 'Cuenca', area: 'Técnica', origen: 'CUE', dep: '3', peso: 0.5 },
  { codigo: 'DV-JA', alias: 'JADE', nombre: 'Asesora Jade', sucursal: 'Guayaquil', area: 'Comercial', origen: 'PRI', dep: '1', peso: 0.3 },
];

function generar(hoy) {
  const facturas = [];
  const movimientos = [];
  const asientos = [];
  for (const mes of mesesEntre(DESDE, hoy)) {
    const { desde, hasta } = rangoDeMes(mes);
    const fin = hasta > hoy ? hoy : hasta;
    const estacional = 1 + 0.25 * Math.sin((Number(mes.slice(5, 7)) / 12) * 2 * Math.PI) + (mes >= '2026-01' ? 0.08 : 0);
    for (let d = Number(desde.slice(8)); d <= Number(fin.slice(8)); d++) {
      const fecha = `${mes}-${String(d).padStart(2, '0')}`;
      const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay();
      if (dow === 0) continue; // domingo sin ventas
      for (const a of ASESORES) {
        const n = Math.floor(entre(0, 2.6 * a.peso));
        for (let i = 0; i < n; i++) {
          const sub = r2(entre(120, 2200) * estacional);
          const desc = rnd() < 0.3 ? r2(sub * entre(0.02, 0.12)) : 0;
          const dev = rnd() < 0.05 ? r2(sub * entre(0.1, 1)) : 0;
          const anulada = rnd() < 0.03;
          facturas.push({
            EMPRESA: 'ADITE', ANIO: Number(mes.slice(0, 4)), MES: Number(mes.slice(5, 7)), FECHA_FACTURA: fecha,
            VENDEDOR: a.codigo, ORIGEN: a.origen, TIPO_DOCUMENTO: 'FACT',
            SUBTOTAL_CON_IVA: sub, SUBTOTAL_SIN_IVA: 0, VALOR_FACTURA: r2(sub * 1.15),
            VALOR_TOTAL_DESCUENTO: desc, TOTAL_DEVOLUCION: dev, ANULADA: anulada,
          });
          const costoPct = a.area === 'Técnica' ? entre(0.32, 0.45) : entre(0.38, 0.52);
          const q = Math.max(1, Math.round(entre(2, 30)));
          movimientos.push({
            CORP: 'ADITE', COD_SALESMAN: a.codigo, ADJUSTMENT_TYPE: 'FT', TRANS_DATE: fecha, QUANTITY: q,
            TOT_RETURN_UNIT: dev ? Math.round(q * (dev / sub)) : 0, TRANS_COST: r2((sub * costoPct) / q),
            NET_LINE_TOTAL: sub, LINE_TOTAL: sub, DISCOUNT_AMOUNT: 0, TOT_RETURN_AMOUNT: dev, UNIT_COST: r2(sub / q), Anulada: anulada,
          });
        }
      }
    }
    // Nómina a fin de mes por departamento (centro 01 comercial, 02 administración) y gastos generales.
    for (const dep of ['1', '2', '3']) {
      const base = dep === '1' ? 1 : dep === '2' ? 0.8 : 0.35;
      const asiento = (cuenta, pc, monto, fecha = fin) => asientos.push({
        CORP: 'ADITE', GL_ACCOUNT_CODE: `${cuenta}100`, GL_MAIN_CODE_ONLY: cuenta, GL_ACCOUNT_TYPE: '', ACCOUNT_NAME: cuenta.startsWith('6111') ? 'GP.SUELDOS DEL PERSONAL' : 'GG.GASTOS VARIOS',
        DEBIT_AMOUNT: r2(monto), CREDIT_AMOUNT: 0, DEPARTMENT_CODE: dep, PROFIT_CENTER_CODE: pc, POST_TO_DATE: fecha, ORIGIN: 'PRI', ADJUSTMENT_TYPE: 'NOMINA', Analisis_Sucursal: 'PRI',
      });
      asiento('61110001', '01', 14000 * base * entre(0.95, 1.05));
      asiento('61110003', '01', 4000 * base * entre(0.7, 1.3));
      asiento('61110001', '02', 9000 * base * entre(0.95, 1.05));
      for (let i = 0; i < 6; i++) asiento('61120006', i % 2 ? '01' : '02', 2200 * base * entre(0.5, 1.5), `${mes}-${String(Math.min(28, 3 + i * 4)).padStart(2, '0')}`);
      asiento('61120200', '02', 300 * base); // excluida
    }
  }
  return { facturas, movimientos, asientos };
}

// ---------------------------------------------------------------- arranque
const hoy = hoyEn(TZ);
const t0 = Date.now();
const datos = generar(hoy);
console.log(`[dev] datos sintéticos: ${datos.facturas.length} facturas · ${datos.movimientos.length} movimientos · ${datos.asientos.length} asientos`);

const mock = await iniciarMock({
  pausaMinMs: 5,
  tablas: {
    CLNT_Factura_Principal: datos.facturas,
    INVT_Producto_Movimientos: datos.movimientos,
    CONT_Asiento_Detalle: datos.asientos,
  },
});
console.log(`[dev] simulador MBA3 en ${mock.url}`);

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aditec-dev-'));
const configDir = path.join(raiz, 'config');
const dataDir = path.join(raiz, 'data');
fs.mkdirSync(configDir);
fs.mkdirSync(dataDir);
const vendedores = ASESORES.map(({ codigo, alias, nombre, sucursal, area }) => ({ codigo, alias, nombre, sucursal, area, activo: true }));
const gastos = {
  confirmado: GASTOS_OK,
  nomina_prefijos: ['6111'],
  generales_prefijos: ['6112'],
  excluir_prefijos: ['61120200', '61120201'],
  asignacion: Object.fromEntries(ASESORES.map((a) => [a.codigo, { department_code: a.dep, profit_center_code: '01' }])),
  sin_asignar: 'prorratear_por_ventas_netas',
};
fs.writeFileSync(path.join(configDir, 'usuarios.json'), JSON.stringify({
  usuarios: [
    { usuario: 'dev', nombre: 'Usuario Desarrollo', rol: 'admin', ...(await hashPassword(CLAVE)) },
    { usuario: 'gerencia', nombre: 'Gerencia Demo', rol: 'gerencia', ...(await hashPassword(CLAVE)) },
  ],
}));

const cfg = {
  port: PUERTO, tz: TZ, dataDir, configDir,
  publicDir: new URL('../public/', import.meta.url).pathname,
  session: { secret: 'dev'.repeat(22), horas: 8, secure: false },
  mba3: { base: mock.url, codigo: 'test', pwd: 'test', empresa: 'ADITE', pausaMs: 5, renovarMs: 8 * 60_000, limit: 5000 },
  sync: { activo: false, mesActualMin: 30, historiaDesde: DESDE },
  vendedores, gastos, umbrales: UMBRALES_DEFECTO, reglas: { vb_ignorar_descuento_igual_valor_factura: false },
};
const silencioso = { log() {}, warn: console.warn, error: console.error };
const sync = crearSincronizador(cfg, { log: silencioso, crearCliente: (o) => new Mba3Client({ ...o, pausaMs: 5, permitirPausaCorta: true }) });
const r = await sync.pasada();
console.log(`[dev] sincronización vía simulador: ${r.ok}/${r.meses} meses · ${r.peticiones} peticiones · ${(r.duracionMs / 1000).toFixed(1)} s · errores ${r.errores}`);

const server = crearApp(cfg, { sync, log: { log() {}, warn() {}, error: console.error } });
server.listen(PUERTO, '0.0.0.0', () => {
  console.log(`[dev] portal listo en http://localhost:${PUERTO}  (usuarios: dev [admin] y gerencia, clave "${CLAVE}")`);
  console.log(`[dev] gastos ${GASTOS_OK ? 'CONFIRMADOS' : 'sin confirmar ("Pendiente de configurar")'} · arranque ${((Date.now() - t0) / 1000).toFixed(1)} s · datos en ${raiz}`);
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { server.close(); await mock.cerrar(); fs.rmSync(raiz, { recursive: true, force: true }); process.exit(0); });
