#!/usr/bin/env node
// Prueba mínima contra MBA3: login + UNA consulta con limit 1 (2 peticiones en total).
// Uso: docker compose exec aditec-portal node scripts/probar-conexion.js
import { crearCliente, config, describirColumnas } from './_comun.js';
import { TABLAS, whereRango, sumarDias } from '../src/mba3/queries.js';
import { hoyEn } from '../src/sync/scheduler.js';

const c = crearCliente('probar-conexion');
const hoy = hoyEn(config.tz);
const desde = sumarDias(hoy, -30);
const t = TABLAS.facturas;
const where = whereRango('facturas', config.mba3.empresa, desde, hoy);

console.log(`MBA3: ${config.mba3.base} · pausa ${config.mba3.pausaMs} ms`);
console.log(`Consulta: ${t.from} WHERE ${where} LIMIT 1`);
const t0 = Date.now();
try {
  const filas = await c.consultar({ select: t.select.join(','), from: t.from, where, limit: 1 });
  console.log(`Resultado: ${filas.length} fila(s) en ${Date.now() - t0} ms (incluye login y pausa)`);
  if (filas.length) {
    console.log('Columnas y tipos:', JSON.stringify(describirColumnas(filas), null, 2));
    console.log('Muestra:', JSON.stringify(filas[0], null, 2));
  }
  console.log(`Peticiones a MBA3 en esta prueba: ${c.peticiones}`);
} catch (e) {
  console.error(`FALLÓ (${e.tipo ?? 'error'}): ${e.message}`);
  console.error(`Peticiones a MBA3 en esta prueba: ${c.peticiones}`);
  process.exit(1);
}
