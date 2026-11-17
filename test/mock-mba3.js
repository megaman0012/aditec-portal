// Simulador de MBA3 para pruebas (sin tocar el servidor real).
// Reproduce: login -> jwt, consultas multipart, vacío {"error":"009"}, error XML 4D,
// "Unauthorized" por JWT expirado y VETO si dos peticiones llegan con menos de pausaMinMs.
//
// Uso en tests:
//   const mock = await iniciarMock({ tablas: { CLNT_Factura_Principal: [...] }, jwtTtlMs: 600000 });
//   ... mock.url, mock.peticiones, mock.vetado ...
//   await mock.cerrar();
import http from 'node:http';
import crypto from 'node:crypto';

const xmlError = (msg) =>
  `<?xml version="1.0" encoding="UTF-8"?><error><contents>${msg}</contents></error>`;

// Parser multipart mínimo (solo campos de texto).
function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = '--' + (m[1] || m[2]);
  const campos = {};
  for (const parte of body.split(boundary)) {
    const nm = /name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n$/.exec(parte);
    if (nm) campos[nm[1]] = nm[2];
  }
  return campos;
}

// Evaluador muy simple de filtros "CAMPO op 'valor' AND ..." (solo AND, para pruebas).
function filtrar(filas, where) {
  if (!where || !where.trim()) return filas;
  if (/<>|\{d\s*'/.test(where)) throw new Error('Sintaxis no soportada por ORDA');
  const conds = where.split(/\s+AND\s+/i).map((c) => {
    const x = /^\s*(\w+)\s*(=|!=|<=|>=|<|>)\s*'?([^']*)'?\s*$/.exec(c);
    if (!x) throw new Error(`Condición no soportada en mock: ${c}`);
    return { campo: x[1], op: x[2], valor: x[3] };
  });
  const cmp = (a, op, b) => {
    a = String(a ?? '');
    switch (op) {
      case '=': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
    }
  };
  return filas.filter((f) => conds.every(({ campo, op, valor }) => cmp(f[campo], op, valor)));
}

export async function iniciarMock({
  tablas = {},
  codigo = 'test',
  pwd = 'test',
  jwtTtlMs = 10 * 60_000,
  pausaMinMs = 1000, // si dos peticiones llegan más juntas que esto -> veto
} = {}) {
  const estado = {
    peticiones: [], // { t, ruta }
    vetado: false,
    jwts: new Map(), // jwt -> expira
    forzarXml: null, // string: próxima respuesta será XML de error
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const ahora = Date.now();
      const ultima = estado.peticiones.at(-1);
      estado.peticiones.push({ t: ahora, ruta: req.url, metodo: req.method });
      if (ultima && ahora - ultima.t < pausaMinMs) estado.vetado = true;

      const enviar = (status, data, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(typeof data === 'string' ? data : JSON.stringify(data));
      };

      if (estado.vetado) return enviar(200, xmlError('IP bloqueada'), 'text/xml');
      if (req.url.startsWith('/ws2_mba3_serv_api_/')) return enviar(200, xmlError('PRUEBA: API de escritura usada'), 'text/xml');

      if (req.url === '/ws2_mba3_serv_/login_servicio' && req.method === 'POST') {
        let j;
        try { j = JSON.parse(body); } catch { return enviar(200, xmlError('JSON inválido'), 'text/xml'); }
        if (j.codigo !== codigo || j.pwd !== pwd) return enviar(200, xmlError('Credenciales inválidas'), 'text/xml');
        const jwt = crypto.randomBytes(24).toString('hex');
        estado.jwts.set(jwt, ahora + jwtTtlMs);
        return enviar(200, { jwt });
      }

      if (req.url === '/ws2_mba3_serv_Consultas_Externas_/' && req.method === 'POST') {
        const auth = req.headers.authorization || '';
        if (auth.startsWith('Bearer ')) return enviar(401, 'Unauthorized', 'text/plain');
        const exp = estado.jwts.get(auth);
        if (!exp || exp < ahora) return enviar(401, 'Unauthorized', 'text/plain');
        if (estado.forzarXml) {
          const msg = estado.forzarXml;
          estado.forzarXml = null;
          return enviar(200, xmlError(msg), 'text/xml');
        }
        const campos = parseMultipart(body, req.headers['content-type']);
        if (!campos || !campos.from) return enviar(200, xmlError('Faltan campos'), 'text/xml');
        const tabla = tablas[campos.from];
        if (!tabla) return enviar(200, xmlError(`Tabla no existe: ${campos.from}`), 'text/xml');
        let filas;
        try { filas = filtrar(tabla, campos.where); } catch (e) { return enviar(200, xmlError(e.message), 'text/xml'); }
        const limit = Number.parseInt(campos.limit, 10);
        if (Number.isFinite(limit)) filas = filas.slice(0, limit);
        if (campos.select && campos.select.trim() !== '*') {
          const cols = campos.select.split(',').map((s) => s.trim());
          filas = filas.map((f) => Object.fromEntries(cols.map((c) => [c, f[c]])));
        }
        if (!filas.length) return enviar(200, { error: '009', respuesta: 'No existen registros para la consulta' });
        return enviar(200, filas);
      }

      enviar(200, 'OK', 'text/plain'); // MBA3 real devuelve 200 a casi todo
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    get peticiones() { return estado.peticiones; },
    get vetado() { return estado.vetado; },
    expirarJwts() { for (const k of estado.jwts.keys()) estado.jwts.set(k, 0); },
    forzarErrorXml(msg) { estado.forzarXml = msg; },
    cerrar: () => new Promise((r) => server.close(r)),
  };
}
