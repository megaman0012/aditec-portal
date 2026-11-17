// Autoprueba del simulador (el cliente real se prueba contra él en Fase 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarMock } from './mock-mba3.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function multipart(campos) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  return fd;
}

test('mock: login, filas, vacío 009, Bearer rechazado y veto por ráfaga', async () => {
  const mock = await iniciarMock({
    pausaMinMs: 100,
    tablas: { T: [{ EMPRESA: 'ADITE', X: 1 }, { EMPRESA: 'OTRA', X: 2 }] },
  });
  try {
    const { jwt } = await (await fetch(`${mock.url}/ws2_mba3_serv_/login_servicio`, {
      method: 'POST', body: JSON.stringify({ codigo: 'test', pwd: 'test' }),
    })).json();
    assert.ok(jwt);
    await espera(120);

    const q = (where, auth = jwt) => fetch(`${mock.url}/ws2_mba3_serv_Consultas_Externas_/`, {
      method: 'POST', headers: { Authorization: auth }, body: multipart({ select: '*', from: 'T', where, limit: '10' }),
    });

    assert.deepEqual(await (await q("EMPRESA = 'ADITE'")).json(), [{ EMPRESA: 'ADITE', X: 1 }]);
    await espera(120);
    assert.equal((await (await q("EMPRESA = 'NADA'")).json()).error, '009');
    await espera(120);
    assert.equal((await q("EMPRESA = 'ADITE'", `Bearer ${jwt}`)).status, 401);
    assert.equal(mock.vetado, false);

    await q("EMPRESA = 'ADITE'"); // sin pausa -> veto
    assert.equal(mock.vetado, true);
  } finally {
    await mock.cerrar();
  }
});
