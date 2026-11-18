// Usuarios del portal: config/usuarios.json = { "usuarios": [ {usuario, nombre, rol, hash, salt, debe_cambiar?, clave_cambiada?} ] }
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

  // Cambia campos de un usuario (p. ej. hash/salt tras cambio de clave). Escritura atómica.
  function actualizar(usuario, cambios) {
    const db = JSON.parse(fs.readFileSync(file, 'utf8'));
    const u = (db.usuarios ?? []).find((x) => String(x.usuario).toLowerCase() === String(usuario).toLowerCase());
    if (!u) throw new Error('Usuario no encontrado');
    Object.assign(u, cambios);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    memo = { mtimeMs: -1, mapa: new Map() };
    return u;
  }

  return {
    buscar: (usuario) => cargar().get(String(usuario ?? '').toLowerCase()) ?? null,
    cantidad: () => cargar().size,
    actualizar,
  };
}
