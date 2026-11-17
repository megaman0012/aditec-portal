// Cliente MBA3 — SOLO LECTURA.
//
// Garantías anti-veto de IP:
// - Cola serial GLOBAL del proceso: una petición a la vez (ninguna llamada concurrente se solapa).
// - Pausa mínima entre peticiones (>= 1500 ms), medida desde que TERMINÓ la anterior. El instante
//   de la última petición se guarda también en data/mba3-ultima.json para respetar la pausa entre
//   procesos (servidor y scripts).
// - Lock de archivo data/mba3.lock: un solo proceso habla con MBA3 a la vez.
// - Tras MAX_RARAS respuestas raras consecutivas el cliente se DETIENE (posible veto).
//
// Nunca se registran el JWT ni la contraseña.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PAUSA_MINIMA_MS = 1500;
const MAX_RARAS = 3;
const TIMEOUT_MS = 120_000;
const RUTA_LOGIN = '/ws2_mba3_serv_/login_servicio';
const RUTA_CONSULTA = '/ws2_mba3_serv_Consultas_Externas_/';

export class Mba3Error extends Error {
  constructor(tipo, mensaje) {
    super(mensaje);
    this.name = 'Mba3Error';
    this.tipo = tipo; // 'xml' | 'rara' | 'red' | 'unauthorized' | 'detenido' | 'lock' | 'config'
  }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const recorte = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// --- Cola serial global (compartida por todas las instancias del proceso) ---
let colaGlobal = Promise.resolve();
let ultimaFinGlobal = 0;

function enCola(fn) {
  const p = colaGlobal.then(fn, fn);
  colaGlobal = p.catch(() => {});
  return p;
}

// Clasifica el cuerpo de una respuesta de MBA3.
export function interpretarRespuesta(status, texto) {
  const t = String(texto ?? '').trim();
  if (status === 401 || /^unauthorized/i.test(t)) return { tipo: 'unauthorized' };
  if (t.startsWith('[')) {
    try {
      const filas = JSON.parse(t);
      if (Array.isArray(filas)) return { tipo: 'filas', filas };
    } catch { /* cae a rara */ }
    return { tipo: 'rara', mensaje: `JSON inválido: ${recorte(t, 80)}` };
  }
  if (t.startsWith('{')) {
    let j;
    try { j = JSON.parse(t); } catch { return { tipo: 'rara', mensaje: `JSON inválido: ${recorte(t, 80)}` }; }
    if (String(j.error) === '009') return { tipo: 'filas', filas: [], vacio: true };
    if (String(j.error) === '003' || /ip no autorizada/i.test(String(j.respuesta ?? ''))) {
      return { tipo: 'ip-bloqueada', mensaje: `IP no autorizada en MBA3 (error=${j.error}): ${recorte(j.respuesta ?? '', 120)}` };
    }
    if (typeof j.jwt === 'string' && j.jwt) return { tipo: 'jwt', jwt: j.jwt };
    if (/unauthorized/i.test(JSON.stringify(j))) return { tipo: 'unauthorized' };
    return { tipo: 'rara', mensaje: `Objeto inesperado (error=${j.error ?? '?'}): ${recorte(j.respuesta ?? j.mensaje ?? '', 120)}` };
  }
  if (t.startsWith('<')) {
    const m = /<contents>([\s\S]*?)<\/contents>/i.exec(t);
    const msg = m ? m[1] : t;
    if (/unauthorized/i.test(msg)) return { tipo: 'unauthorized' };
    return { tipo: 'xml', mensaje: recorte(msg) };
  }
  return { tipo: 'rara', mensaje: `HTTP ${status}: ${recorte(t, 120) || '(vacío)'}` };
}

export class Mba3Client {
  /**
   * @param {object} o
   * @param {string} o.base  @param {string} o.codigo  @param {string} o.pwd
   * @param {number} [o.pausaMs] @param {number} [o.renovarMs] @param {string} [o.dataDir]
   * @param {(evento:object)=>void} [o.alEvento] notificación de eventos (sin secretos)
   */
  constructor(o) {
    if (!o?.base || !o.codigo || !o.pwd) throw new Mba3Error('config', 'Faltan MBA3_BASE, MBA3_CODIGO o MBA3_PWD');
    this.base = o.base.replace(/\/+$/, '');
    const pausaCortaPermitida = process.env.NODE_ENV === 'test' && o.permitirPausaCorta === true;
    this.pausaMs = pausaCortaPermitida ? o.pausaMs : Math.max(PAUSA_MINIMA_MS, o.pausaMs ?? PAUSA_MINIMA_MS);
    this.renovarMs = o.renovarMs ?? 8 * 60_000;
    this.dataDir = o.dataDir ?? null;
    this.alEvento = o.alEvento ?? (() => {});
    // Credenciales en propiedades no enumerables: no salen en JSON.stringify/console.log.
    Object.defineProperty(this, '_cred', { value: { codigo: o.codigo, pwd: o.pwd }, enumerable: false });
    Object.defineProperty(this, '_jwt', { value: null, writable: true, enumerable: false });
    this.jwtObtenido = 0;
    this.rarasSeguidas = 0;
    this.detenido = false;
    this.motivoDetencion = null;
    this.peticiones = 0;
    this.lockTomado = false;
  }

  // ---------- lock entre procesos ----------
  get rutaLock() { return this.dataDir && path.join(this.dataDir, 'mba3.lock'); }
  get rutaUltima() { return this.dataDir && path.join(this.dataDir, 'mba3-ultima.json'); }

  tomarLock(dueno) {
    if (!this.dataDir || this.lockTomado) return;
    fs.mkdirSync(this.dataDir, { recursive: true });
    const datos = JSON.stringify({ pid: process.pid, host: os.hostname(), dueno, desde: new Date().toISOString() });
    try {
      fs.writeFileSync(this.rutaLock, datos, { flag: 'wx' });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let previo = {};
      try { previo = JSON.parse(fs.readFileSync(this.rutaLock, 'utf8')); } catch {}
      const vivo = previo.host === os.hostname() ? procesoVivo(previo.pid) : true;
      if (vivo && previo.pid !== process.pid) {
        throw new Mba3Error('lock', `MBA3 en uso por otro proceso (${previo.dueno ?? '?'}, pid ${previo.pid}). Espera a que termine.`);
      }
      fs.writeFileSync(this.rutaLock, datos); // lock huérfano: se reemplaza
    }
    this.lockTomado = true;
  }

  soltarLock() {
    if (!this.lockTomado) return;
    try { fs.unlinkSync(this.rutaLock); } catch {}
    this.lockTomado = false;
  }

  ultimaFin() {
    let disco = 0;
    if (this.rutaUltima) {
      try { disco = JSON.parse(fs.readFileSync(this.rutaUltima, 'utf8')).t || 0; } catch {}
    }
    return Math.max(ultimaFinGlobal, disco);
  }

  marcarFin() {
    ultimaFinGlobal = Date.now();
    if (this.rutaUltima) {
      try { fs.writeFileSync(this.rutaUltima, JSON.stringify({ t: ultimaFinGlobal })); } catch {}
    }
  }

  // ---------- petición HTTP única (siempre dentro de la cola) ----------
  async _peticion(ruta, init) {
    if (ruta.includes('_api_')) throw new Mba3Error('config', 'API de escritura prohibida');
    if (this.detenido) throw new Mba3Error('detenido', `Cliente detenido: ${this.motivoDetencion}`);
    return enCola(async () => {
      if (this.detenido) throw new Mba3Error('detenido', `Cliente detenido: ${this.motivoDetencion}`);
      const faltan = this.ultimaFin() + this.pausaMs - Date.now();
      if (faltan > 0) await espera(faltan);
      const t0 = Date.now();
      this.peticiones++;
      try {
        const res = await fetch(this.base + ruta, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const texto = await res.text();
        return { status: res.status, texto, ms: Date.now() - t0 };
      } catch (e) {
        throw new Mba3Error('red', `Error de red: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`);
      } finally {
        this.marcarFin();
      }
    });
  }

  _registrarResultado(ok, detalle, { fatal = false } = {}) {
    if (ok) {
      this.rarasSeguidas = 0;
      return;
    }
    if (fatal) {
      // IP no autorizada / vetada: insistir solo empeora. Detener de inmediato.
      this.detenido = true;
      this.motivoDetencion = `${detalle}. Autorizar/desbloquear la IP en MBA3 > Servicios de Acceso Externo > IPs.`;
      this.alEvento({ tipo: 'detenido', motivo: this.motivoDetencion });
      return;
    }
    this.rarasSeguidas++;
    this.alEvento({ tipo: 'respuesta-rara', n: this.rarasSeguidas, detalle });
    if (this.rarasSeguidas >= MAX_RARAS) {
      this.detenido = true;
      this.motivoDetencion = `${MAX_RARAS} respuestas raras seguidas (última: ${detalle}). Posible veto de IP: revisar MBA3 > Servicios de Acceso Externo > IPs.`;
      this.alEvento({ tipo: 'detenido', motivo: this.motivoDetencion });
    }
  }

  // Un solo login a la vez: llamadas concurrentes esperan el mismo login.
  login() {
    if (!this._loginEnCurso) {
      this._loginEnCurso = this._login().finally(() => { this._loginEnCurso = null; });
    }
    return this._loginEnCurso;
  }

  async _login() {
    let r;
    try {
      r = await this._peticion(RUTA_LOGIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: this._cred.codigo, pwd: this._cred.pwd }),
      });
    } catch (e) {
      if (e.tipo === 'red') this._registrarResultado(false, e.message);
      throw e;
    }
    const i = interpretarRespuesta(r.status, r.texto);
    if (i.tipo !== 'jwt') {
      const msg = i.mensaje ?? i.tipo;
      this._registrarResultado(false, `login: ${msg}`, { fatal: i.tipo === 'ip-bloqueada' });
      throw new Mba3Error(i.tipo === 'xml' || i.tipo === 'ip-bloqueada' ? i.tipo : 'rara', `Login rechazado: ${msg}`);
    }
    this._jwt = i.jwt;
    this.jwtObtenido = Date.now();
    this._registrarResultado(true);
    this.alEvento({ tipo: 'login', ms: r.ms });
  }

  jwtVigente() {
    return !!this._jwt && Date.now() - this.jwtObtenido < this.renovarMs;
  }

  /**
   * Consulta de lectura. Devuelve un arreglo de filas ([] si MBA3 responde "009").
   * @param {{select:string, from:string, where?:string, limit?:number}} q
   */
  async consultar({ select, from, where = '', limit }) {
    if (!select || !from) throw new Mba3Error('config', 'select y from son obligatorios');
    if (/<>|\{d\s*'/i.test(where)) throw new Mba3Error('config', 'Filtro ORDA inválido: no usar <> ni {d ...}');

    for (let intento = 0; intento < 2; intento++) {
      if (!this.jwtVigente()) await this.login();
      const fd = new FormData();
      fd.append('select', select);
      fd.append('from', from);
      fd.append('where', where);
      if (limit != null) fd.append('limit', String(limit));

      let r;
      try {
        r = await this._peticion(RUTA_CONSULTA, { method: 'POST', headers: { Authorization: this._jwt }, body: fd });
      } catch (e) {
        if (e.tipo === 'red') this._registrarResultado(false, e.message);
        throw e;
      }
      const i = interpretarRespuesta(r.status, r.texto);
      if (i.tipo === 'filas') {
        this._registrarResultado(true);
        this.alEvento({ tipo: 'consulta', from, filas: i.filas.length, vacio: !!i.vacio, ms: r.ms });
        return i.filas;
      }
      if (i.tipo === 'unauthorized' && intento === 0) {
        this._jwt = null; // renovar y reintentar UNA vez
        this.alEvento({ tipo: 'reintento-unauthorized', from });
        continue;
      }
      const msg = i.tipo === 'unauthorized' ? 'Unauthorized tras renovar sesión' : i.mensaje;
      this._registrarResultado(false, `${from}: ${msg}`, { fatal: i.tipo === 'ip-bloqueada' });
      throw new Mba3Error(i.tipo === 'unauthorized' ? 'unauthorized' : i.tipo, `${from}: ${msg}`);
    }
  }

  // Para logs: nunca incluye jwt ni credenciales.
  toJSON() {
    return {
      base: this.base,
      pausaMs: this.pausaMs,
      sesion: this._jwt ? 'activa' : 'sin sesión',
      peticiones: this.peticiones,
      rarasSeguidas: this.rarasSeguidas,
      detenido: this.detenido,
    };
  }
}

function procesoVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}
