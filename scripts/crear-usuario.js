#!/usr/bin/env node
// Crea o actualiza un usuario del portal en config/usuarios.json (hash scrypt, nunca texto plano).
// Uso (pide la contraseña sin mostrarla):
//   node scripts/crear-usuario.js <usuario> "<Nombre visible>" [rol]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { hashPassword } from '../src/auth/passwords.js';

const [usuario, nombre, rol = 'lector'] = process.argv.slice(2);
if (!usuario || !nombre || !/^[a-z0-9._-]{3,32}$/i.test(usuario)) {
  console.error('Uso: node scripts/crear-usuario.js <usuario> "<Nombre visible>" [lector|admin]');
  process.exit(1);
}
if (!['lector', 'admin'].includes(rol)) {
  console.error('Rol inválido: usa lector o admin');
  process.exit(1);
}

function preguntarOculto(texto) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(texto)) rl.output.write(s); };
    rl.question(texto, (v) => { rl.close(); process.stdout.write('\n'); resolve(v); });
  });
}

const pwd = await preguntarOculto('Contraseña (mín. 10): ');
const pwd2 = await preguntarOculto('Repite la contraseña: ');
if (pwd !== pwd2) {
  console.error('Las contraseñas no coinciden');
  process.exit(1);
}

const file = path.join(process.env.CONFIG_DIR || new URL('../config/', import.meta.url).pathname, 'usuarios.json');
const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { usuarios: [] };
const existente = db.usuarios.find((u) => u.usuario === usuario);
const registro = { usuario, nombre, rol, hash: hashPassword(pwd), actualizado: new Date().toISOString() };
if (existente) Object.assign(existente, registro);
else db.usuarios.push(registro);

const tmp = `${file}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 });
fs.renameSync(tmp, file);
console.log(`Usuario "${usuario}" ${existente ? 'actualizado' : 'creado'} (${rol}).`);
