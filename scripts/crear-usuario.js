#!/usr/bin/env node
// Crea o actualiza un usuario del portal en config/usuarios.json (scrypt: hash + salt; nunca texto plano).
// La contraseña se pide por consola SIN mostrarla. Uso en el servidor:
//   docker compose exec -it aditec-portal node scripts/crear-usuario.js <usuario> "<Nombre>" <admin|gerencia> [--temporal]
// --temporal: clave provisional (mín. 6) que el usuario DEBE cambiar en su primer ingreso.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { hashPassword, MIN_LONGITUD } from '../src/auth/passwords.js';
import { ROLES, USUARIO_VALIDO } from '../src/auth/users.js';

const temporal = process.argv.includes('--temporal');
const [usuarioArg, nombre, rol] = process.argv.slice(2).filter((a) => a !== '--temporal');
const usuario = String(usuarioArg ?? '').toLowerCase();
if (!USUARIO_VALIDO.test(usuario) || !nombre || !ROLES.includes(rol)) {
  console.error(`Uso: node scripts/crear-usuario.js <usuario> "<Nombre visible>" <${ROLES.join('|')}>`);
  console.error('usuario: 3-32 caracteres a-z 0-9 . _ -');
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error('Se necesita una terminal interactiva (usa docker run -it).');
  process.exit(1);
}

// Lee una línea sin eco en pantalla.
function preguntarOculto(texto) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(texto)) rl.output.write(s); };
    rl.question(texto, (v) => { rl.close(); process.stdout.write('\n'); resolve(v); });
  });
}

const minimo = temporal ? 6 : MIN_LONGITUD;
const pwd = await preguntarOculto(`Contraseña${temporal ? ' temporal' : ''} (mín. ${minimo}): `);
const pwd2 = await preguntarOculto('Repite la contraseña: ');
if (pwd !== pwd2) { console.error('Las contraseñas no coinciden'); process.exit(1); }

let cred;
try { cred = await hashPassword(pwd, { minimo }); } catch (e) { console.error(e.message); process.exit(1); }

const file = path.join(process.env.CONFIG_DIR || new URL('../config/', import.meta.url).pathname, 'usuarios.json');
const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { usuarios: [] };
db.usuarios ??= [];
const existente = db.usuarios.find((u) => String(u.usuario).toLowerCase() === usuario);
const registro = { usuario, nombre, rol, ...cred, debe_cambiar: temporal, actualizado: new Date().toISOString() };
if (existente) {
  for (const k of Object.keys(existente)) delete existente[k];
  Object.assign(existente, registro);
} else {
  db.usuarios.push(registro);
}

const tmp = `${file}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 });
fs.renameSync(tmp, file);
console.log(`Usuario "${usuario}" ${existente ? 'actualizado' : 'creado'} (${rol})${temporal ? ' con clave temporal: deberá cambiarla al ingresar' : ''}. No hace falta reiniciar.`);
