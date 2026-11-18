#!/usr/bin/env node
// Explora una tabla de MBA3 con pocas filas (respeta cola serial, pausa y lock).
// Uso:
//   docker compose exec aditec-portal node scripts/explorar.js <TABLA> [--select=A,B] [--where="..."] [--limit=3] [--guardar=nombre]
// Ej.: node scripts/explorar.js CONT_Asiento_Detalle --where="POST_TO_DATE >= '2026-10-01'" --limit=5 --guardar=asientos-muestra
// --guardar escribe las filas crudas en data/exploracion/<nombre>.json (no versionado).
import fs from 'node:fs';
import path from 'node:path';
import { crearCliente, args, salir, describirColumnas, config } from './_comun.js';

const a = args();
const from = a._[0];
if (!from || !/^[A-Za-z0-9_]+$/.test(from)) salir('Uso: node scripts/explorar.js <TABLA> [--select=A,B] [--where="..."] [--limit=3] [--guardar=nombre]');
const limit = Math.min(Number.parseInt(a.limit ?? '3', 10) || 3, 50); // exploración: máximo 50 filas
const select = a.select ?? '*';
const where = a.where ?? '';
if (a.guardar && !/^[A-Za-z0-9._-]+$/.test(a.guardar)) salir('--guardar: solo letras, números, . _ -');

const c = crearCliente('explorar');
try {
  const filas = await c.consultar({ select, from, where, limit });
  console.log(`${from}: ${filas.length} fila(s) · peticiones MBA3: ${c.peticiones}`);
  if (filas.length) {
    console.log('Columnas y tipos:', JSON.stringify(describirColumnas(filas), null, 2));
    if (!a.guardar) console.log(JSON.stringify(filas, null, 2));
  }
  if (a.guardar) {
    const dir = path.join(config.dataDir, 'exploracion');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${a.guardar}.json`);
    fs.writeFileSync(file, JSON.stringify({ from, select, where, limit, fecha: new Date().toISOString(), filas }, null, 2));
    console.log(`Guardado en data/exploracion/${a.guardar}.json`);
  }
} catch (e) {
  salir(`FALLÓ (${e.tipo ?? 'error'}): ${e.message} · peticiones MBA3: ${c.peticiones}`);
}
