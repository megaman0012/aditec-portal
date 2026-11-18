// Aplicación HTTP del Portal ADITEC (sin frameworks). La web lee SOLO la caché vía repo;
// ningún endpoint llama a MBA3 (la recarga admin solo ENCOLA trabajo para el sincronizador).

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { send, sendJson, HttpError, leerCuerpo, fechaValida, mesValido, lista, crearIpDe } from './http.js';
import { crearUsuarios, USUARIO_VALIDO } from './auth/users.js';
import { crearSesiones, leerCookies, COOKIE } from './auth/sessions.js';
import { crearRateLimit } from './auth/ratelimit.js';
import { verifyPassword, verificacionFalsa, hashPassword, MIN_LONGITUD } from './auth/passwords.js';
import { crearRepo } from './data/repo.js';
import { mesesEntre } from './mba3/queries.js';
import { hoyEn } from './sync/scheduler.js';
import { calcular } from './calc/metrics.js';

export const VERSION = '0.3.0';
const MAX_MESES = 24;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * @param {object} cfg  configuración (src/config.js)
 * @param {{sync?:object, repo?:object, log?:object, rateLimit?:object}} deps
 */
export function crearApp(cfg, deps = {}) {
  const log = deps.log ?? console;
  const repo = deps.repo ?? crearRepo(cfg);
  const sync = deps.sync ?? null;
  const usuarios = crearUsuarios(cfg.configDir);
  const sesiones = crearSesiones({ secret: cfg.session.secret, horas: cfg.session.horas, secure: cfg.session.secure });
  const limite = deps.rateLimit ?? crearRateLimit();
  const ipDe = crearIpDe(cfg.proxy ?? {});

  // --- sesión ---
  function sesionDe(req) {
    const s = sesiones.verificar(leerCookies(req)[COOKIE]);
    if (!s) return null;
    const u = usuarios.buscar(s.u);
    if (!u) return null;
    // Una sesión emitida antes del último cambio de clave deja de valer.
    if (u.clave_cambiada && s.iat < Date.parse(u.clave_cambiada)) return null;
    // rol y obligación de cambiar la clave siempre desde usuarios.json
    return { ...s, usuario: u.usuario, nombre: u.nombre, rol: u.rol, debeCambiar: u.debe_cambiar === true };
  }
  function requerir(req, rol, { permitirCambioPendiente = false } = {}) {
    const s = req.sesion;
    if (!s) throw new HttpError(401, 'Sesión requerida');
    if (s.debeCambiar && !permitirCambioPendiente) {
      throw new HttpError(403, 'Debes cambiar tu contraseña antes de continuar', { 'X-Cambiar-Clave': '1' });
    }
    if (rol && s.rol !== rol) throw new HttpError(403, 'Solo administradores');
    return s;
  }
  // CSRF: además de SameSite=Strict, un POST con Origin debe venir del mismo host.
  function mismoOrigen(req) {
    const o = req.headers.origin;
    if (!o) return true;
    try { return new URL(o).host === req.headers.host; } catch { return false; }
  }

  // --- parámetros del tablero ---
  function filtrosDe(q) {
    const hoy = hoyEn(cfg.tz);
    const desde = q.get('desde') || `${hoy.slice(0, 7)}-01`;
    const hasta = q.get('hasta') || hoy;
    if (!fechaValida(desde) || !fechaValida(hasta)) throw new HttpError(400, 'Fechas inválidas (AAAA-MM-DD)');
    if (desde > hasta) throw new HttpError(400, '"desde" debe ser menor o igual que "hasta"');
    if (mesesEntre(desde, hasta).length > MAX_MESES) throw new HttpError(400, `Rango máximo: ${MAX_MESES} meses`);
    return {
      desde, hasta,
      sucursales: lista(q.get('sucursal'), { nombre: 'sucursal', max: 10 }),
      areas: lista(q.get('area'), { nombre: 'area', max: 10 }),
      vendedores: lista(q.get('vendedores'), { nombre: 'vendedores', max: 100 }),
    };
  }

  function tablero(q) {
    const filtros = filtrosDe(q);
    const r = repo.resumen(filtros);
    return {
      asesores: r.asesores,
      nacional: r.totalNacional,
      filtro: r.totalFiltro,
      promedio: r.promedio,
      porSucursal: r.porSucursal,
      comparativo: r.comparativo,
      meta: {
        desde: r.desde,
        hasta: r.hasta,
        actualizado: r.actualizado,
        cobertura: r.cobertura,
        pendientes: {
          mesesSinDatos: r.cobertura.faltantes,
          gastos: r.etiquetaGastos,
        },
        gastosNoAsignados: r.gastosNoAsignados,
        filtros,
      },
    };
  }

  // --- CSV (separador ';' y coma decimal, para Excel en español) ---
  function csvTablero(t) {
    const num = (v) => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
    const pct = (v) => (v == null ? '' : String(Math.round(v * 10000) / 100).replace('.', ','));
    const txt = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita inyección de fórmulas
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const pend = t.meta.pendientes.gastos;
    const g = (v) => (pend ? pend : num(v));
    const gp = (v) => (pend ? pend : pct(v));
    const cab = ['Código', 'Alias', 'Nombre', 'Sucursal', 'Área', 'Facturas', 'Ventas brutas', 'Desc. y devol.', 'Ventas netas',
      'Costo de ventas', 'Utilidad bruta', 'Gastos nómina', 'Gastos generales', 'Gastos totales', 'Utilidad neta',
      'Utilidad (VN-gastos)', 'Rentab. utilidad neta %', 'Rentabilidad %', '% Descuentos', '% Costo', '% Margen bruto', '% Part. VN'];
    const filas = t.asesores.map((a) => [
      txt(a.asesor), txt(a.alias), txt(a.nombre), txt(a.sucursal), txt(a.area), a.nFacturas,
      num(a.vb), num(a.dd), num(a.vn), num(a.cv), num(a.ub), g(a.gn), g(a.gg), g(a.gt), g(a.un), g(a.u),
      gp(a.run), gp(a.r), pct(a.pctD), pct(a.pctC), pct(a.pctMB), pct(a.part.vn),
    ]);
    const n = t.nacional;
    filas.push(['TOTAL NACIONAL', '', '', '', '', n.nFacturas, num(n.vb), num(n.dd), num(n.vn), num(n.cv), num(n.ub),
      g(n.gn), g(n.gg), g(n.gt), g(n.un), g(n.u), gp(n.run), gp(n.r), pct(n.pctD), pct(n.pctC), pct(n.pctMB), '100']);
    const meta = `Periodo;${t.meta.desde};${t.meta.hasta};Actualizado;${t.meta.actualizado ?? ''}`;
    return '﻿' + [meta, cab.map(txt).join(';'), ...filas.map((f) => f.join(';'))].join('\r\n') + '\r\n';
  }

  function filtrosDisponibles() {
    const meses = repo.mesesDisponibles();
    const hoy = hoyEn(cfg.tz);
    const vendedores = (cfg.vendedores ?? []).filter((v) => v.activo !== false)
      .map((v) => ({ codigo: v.codigo, alias: v.alias || v.codigo, nombre: v.nombre || '', sucursal: v.sucursal || '', area: v.area || '' }));
    let sucursales = new Set(vendedores.map((v) => v.sucursal).filter(Boolean));
    let areas = new Set(vendedores.map((v) => v.area).filter(Boolean));
    if (meses.length) {
      // Sucursal efectiva (catálogo o ORIGEN predominante) según los últimos 12 meses con datos.
      const ultimos = meses.slice(-12);
      const desde = `${ultimos[0]}-01`;
      const datos = repo.cargar(desde, hoy);
      const r = calcular(datos, { desde, hasta: hoy }, { vendedores: cfg.vendedores, gastos: { confirmado: false } });
      for (const a of r.asesores) { if (a.sucursal) sucursales.add(a.sucursal); if (a.area) areas.add(a.area); }
      for (const v of vendedores) if (!v.sucursal) v.sucursal = r.asesores.find((a) => a.asesor === v.codigo)?.sucursal ?? '';
    }
    const ultimoMes = meses.at(-1);
    const finUltimo = ultimoMes ? new Date(Date.UTC(+ultimoMes.slice(0, 4), +ultimoMes.slice(5, 7), 0)).toISOString().slice(0, 10) : null;
    return {
      sucursales: [...sucursales].sort(),
      areas: [...areas].sort(),
      vendedores,
      meses,
      rango: meses.length ? { desde: `${meses[0]}-01`, hasta: finUltimo < hoy ? finUltimo : hoy } : null,
      maxMeses: MAX_MESES,
    };
  }

  // --- rutas ---
  async function api(req, res, url) {
    const { pathname } = url;
    const q = url.searchParams;
    const m = req.method;

    if (pathname === '/api/login' && m === 'POST') {
      const ip = ipDe(req);
      const espera = limite.bloqueado(ip);
      if (espera) {
        const seg = Math.ceil(espera / 1000);
        log.warn(`[auth] login bloqueado ip=${ip} (${seg}s)`);
        throw new HttpError(429, 'Demasiados intentos. Intenta más tarde.', { 'Retry-After': String(seg) });
      }
      const body = await leerCuerpo(req);
      const usuario = String(body.usuario ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const u = USUARIO_VALIDO.test(usuario) ? usuarios.buscar(usuario) : null;
      const ok = u ? await verifyPassword(password, u) : await verificacionFalsa(password);
      if (!ok) {
        const bloqueado = limite.fallo(ip);
        log.warn(`[auth] login FALLIDO usuario=${USUARIO_VALIDO.test(usuario) ? usuario : '(inválido)'} ip=${ip}${bloqueado ? ' -> IP bloqueada 15 min' : ''}`);
        throw new HttpError(401, 'Usuario o contraseña incorrectos');
      }
      limite.exito(ip);
      log.log(`[auth] login OK usuario=${u.usuario} rol=${u.rol} ip=${ip}`);
      return sendJson(res, 200, { usuario: u.usuario, nombre: u.nombre, rol: u.rol, debeCambiar: u.debe_cambiar === true },
        { 'Set-Cookie': sesiones.cookieLogin(sesiones.emitir(u.usuario)) });
    }

    if (pathname === '/api/cambiar-clave' && m === 'POST') {
      const s = requerir(req, null, { permitirCambioPendiente: true });
      const ip = ipDe(req);
      const espera = limite.bloqueado(ip);
      if (espera) throw new HttpError(429, 'Demasiados intentos. Intenta más tarde.', { 'Retry-After': String(Math.ceil(espera / 1000)) });
      const body = await leerCuerpo(req);
      const actual = String(body.actual ?? '');
      const nueva = String(body.nueva ?? '');
      const u = usuarios.buscar(s.usuario);
      if (!u || !(await verifyPassword(actual, u))) {
        limite.fallo(ip);
        log.warn(`[auth] cambio de clave FALLIDO (clave actual incorrecta) usuario=${s.usuario} ip=${ip}`);
        throw new HttpError(400, 'La contraseña actual no es correcta');
      }
      if (nueva.length < MIN_LONGITUD) throw new HttpError(400, `La nueva contraseña debe tener al menos ${MIN_LONGITUD} caracteres`);
      if (nueva === actual) throw new HttpError(400, 'La nueva contraseña debe ser distinta de la actual');
      if (nueva.toLowerCase().includes(s.usuario.toLowerCase())) throw new HttpError(400, 'La contraseña no puede contener el nombre de usuario');
      if (/^(.)\1+$/.test(nueva) || /^(0123456789|1234567890|123456789|qwertyuiop)/i.test(nueva)) throw new HttpError(400, 'La contraseña es demasiado fácil de adivinar');
      const cred = await hashPassword(nueva);
      const ahora = new Date();
      usuarios.actualizar(s.usuario, { ...cred, debe_cambiar: false, clave_cambiada: ahora.toISOString() });
      limite.exito(ip);
      log.log(`[auth] cambio de clave OK usuario=${s.usuario} ip=${ip}`);
      // Nueva cookie (las sesiones anteriores de este usuario quedan invalidadas).
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sesiones.cookieLogin(sesiones.emitir(s.usuario)) });
    }

    if (pathname === '/api/logout' && m === 'POST') {
      if (req.sesion) { sesiones.revocar(req.sesion); log.log(`[auth] logout usuario=${req.sesion.usuario}`); }
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sesiones.cookieLogout() });
    }

    if (m !== 'GET' && !(m === 'POST' && pathname === '/api/admin/recargar')) throw new HttpError(405, 'Método no permitido');

    if (pathname === '/api/me') {
      const s = requerir(req, null, { permitirCambioPendiente: true });
      return sendJson(res, 200, { usuario: s.usuario, nombre: s.nombre, rol: s.rol, debeCambiar: s.debeCambiar, expira: new Date(s.exp).toISOString() });
    }
    if (pathname === '/api/filtros') {
      requerir(req);
      return sendJson(res, 200, filtrosDisponibles());
    }
    if (pathname === '/api/tablero') {
      requerir(req);
      return sendJson(res, 200, tablero(q));
    }
    if (pathname === '/api/tablero.csv') {
      requerir(req);
      const t = tablero(q);
      return send(res, 200, csvTablero(t), 'text/csv; charset=utf-8', {
        'Content-Disposition': `attachment; filename="rentabilidad_${t.meta.desde}_${t.meta.hasta}.csv"`,
      });
    }
    if (pathname === '/api/estado') {
      requerir(req, 'admin');
      return sendJson(res, 200, { sincronizador: sync ? sync.estado() : null, mesesEnCache: repo.mesesDisponibles(), version: VERSION });
    }
    if (pathname === '/api/admin/recargar' && m === 'POST') {
      const s = requerir(req, 'admin');
      const mes = q.get('mes');
      if (!mesValido(mes)) throw new HttpError(400, 'mes=AAAA-MM');
      const hoy = hoyEn(cfg.tz).slice(0, 7);
      if (mes > hoy || mes < cfg.sync.historiaDesde.slice(0, 7)) throw new HttpError(400, `Mes fuera de rango (${cfg.sync.historiaDesde.slice(0, 7)} .. ${hoy})`);
      if (!sync) throw new HttpError(503, 'Sincronizador no disponible');
      let r;
      try { r = sync.recargarMes(mes); } catch (e) { throw new HttpError(409, e.message); }
      log.log(`[admin] recarga encolada mes=${mes} por usuario=${s.usuario}`);
      return sendJson(res, 202, r);
    }
    throw new HttpError(404, 'No encontrado');
  }

  async function estatico(req, res, pathname, search = '') {
    // La página principal exige sesión; el login y los recursos son públicos.
    if ((pathname === '/' || pathname === '/index.html') && !req.sesion) {
      const volver = search ? `?volver=${encodeURIComponent(`/${search}`)}` : '';
      return send(res, 302, '', 'text/plain; charset=utf-8', { Location: `/login.html${volver}` });
    }
    if (pathname === '/login.html' && req.sesion) {
      return send(res, 302, '', 'text/plain; charset=utf-8', { Location: req.sesion.debeCambiar ? '/cambiar-clave.html' : '/' });
    }
    // Con clave temporal, la única página permitida es la de cambio de clave.
    if ((pathname === '/' || pathname === '/index.html') && req.sesion?.debeCambiar) {
      return send(res, 302, '', 'text/plain; charset=utf-8', { Location: '/cambiar-clave.html' });
    }
    if (pathname === '/cambiar-clave.html' && !req.sesion) {
      return send(res, 302, '', 'text/plain; charset=utf-8', { Location: '/login.html' });
    }
    const root = path.resolve(cfg.publicDir);
    let rel;
    try { rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return send(res, 400, 'Solicitud inválida'); }
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, 'Prohibido');
    try {
      const data = await fs.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const cache = file.includes(`${path.sep}vendor${path.sep}`) ? { 'Cache-Control': 'public, max-age=86400' } : {};
      send(res, 200, req.method === 'HEAD' ? undefined : data, type, cache);
    } catch {
      send(res, 404, 'No encontrado');
    }
  }

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, 'Solicitud inválida'); }
    req.sesion = sesionDe(req);
    res.on('finish', () => {
      if (url.pathname === '/health') return;
      log.log(`[acceso] ${ipDe(req)} ${req.sesion?.usuario ?? '-'} ${req.method} ${url.pathname}${url.search} ${res.statusCode} ${Date.now() - t0}ms`);
    });
    try {
      if (url.pathname === '/health') {
        return sendJson(res, 200, { ok: true, servicio: 'aditec-portal', version: VERSION, hora: new Date().toISOString() });
      }
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'POST' && !mismoOrigen(req)) throw new HttpError(403, 'Origen no permitido');
        return await api(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido', undefined, { Allow: 'GET, HEAD' });
      return await estatico(req, res, url.pathname, url.search);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message }, err.extra);
      log.error('[http] error:', err.message);
      return sendJson(res, 500, { error: 'Error interno' });
    }
  });

  return server;
}
