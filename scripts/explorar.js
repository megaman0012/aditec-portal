#!/usr/bin/env node
// Explora una tabla de MBA3 con pocas filas (respeta cola serial, pausa y lock).
// Uso:
//   docker compose exec portal node scripts/explorar.js <TABLA> [--select=A,B] [--where="..."] [--limit=3]
// Ej.: node scripts/explorar.js CONT_Asiento_Detalle --where="POST_TO_DATE >= '2026-10-01'" --limit=5
import { crearCliente, args, salir, describirColumnas } from './_comun.js';

const a = args();
const from = a._[0];
if (!from || !/^[A-Za-z0-9_]+$/.test(from)) salir('Uso: node scripts/explorar.js <TABLA> [--select=A,B] [--where="..."] [--limit=3]');
const limit = Math.min(Number.parseInt(a.limit ?? '3', 10) || 3, 50); // exploración: máximo 50 filas
const select = a.select ?? '*';
const where = a.where ?? '';

const c = crearCliente('explorar');
try {
  const filas = await c.consultar({ select, from, where, limit });
  console.log(`${from}: ${filas.length} fila(s)`);
  if (filas.length) {
    console.log('Columnas y tipos:', JSON.stringify(describirColumnas(filas), null, 2));
    console.log(JSON.stringify(filas, null, 2));
  }
} catch (e) {
  salir(`FALLÓ (${e.tipo ?? 'error'}): ${e.message}`);
}
