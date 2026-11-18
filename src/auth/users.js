// Usuarios del portal: config/usuarios.json = { "usuarios": [ {usuario, nombre, rol, hash, salt} ] }
// Se relee cuando cambia el archivo (crear un usuario no requiere reiniciar).
import fs from 'node:fs';
import path from 'node:path';

export const ROLES = ['admin', 'gerencia'];
export const USUARIO_VALIDO = /^[a-z0-9._-]{3,32}$/;

export function crearUsuarios(configDir) {
  const file = path.join(configDir, 'usuarios.json');
  let memo = { mtimeMs: -1, mapa: new Map() };

  function cargar() {
    let st;
    try { st = fs.statSync(file); } catch { memo = { mtimeMs: -1, mapa: new Map() }; return memo.mapa; }
    if (st.mtimeMs === memo.mtimeMs) return memo.mapa;
    try {
      const db = JSON.parse(fs.readFileSync(file, 'utf8'));
      const mapa = new Map();
      for (const u of db.usuarios ?? []) {
        if (u?.usuario && ROLES.includes(u.rol) && u.hash && u.salt) mapa.set(String(u.usuario).toLowerCase(), u);
      }
      memo = { mtimeMs: st.mtimeMs, mapa };
    } catch (e) {
      console.error('[auth] usuarios.json ilegible:', e.message);
    }
    return memo.mapa;
  }

  return {
    buscar: (usuario) => cargar().get(String(usuario ?? '').toLowerCase()) ?? null,
    cantidad: () => cargar().size,
  };
}
