// Cambio de contraseña (obligatorio con clave temporal, o voluntario desde el tablero).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const error = $('error');
  const boton = $('btn-guardar');
  const mostrar = (msg) => { error.textContent = msg; error.hidden = false; };

  fetch('/api/me', { credentials: 'same-origin' })
    .then((r) => (r.status === 401 ? (location.href = '/login.html') : r.json()))
    .then((me) => {
      if (!me) return;
      if (me.debeCambiar) {
        $('aviso-temporal').hidden = false;
        $('motivo').textContent = `Hola ${me.nombre || me.usuario}.`;
      }
    })
    .catch(() => {});

  $('form-clave').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.hidden = true;
    const actual = $('actual').value;
    const nueva = $('nueva').value;
    if (!actual || !nueva) return mostrar('Completa todos los campos.');
    if (nueva.length < 10) return mostrar('La nueva contraseña debe tener al menos 10 caracteres.');
    if (nueva !== $('nueva2').value) return mostrar('Las contraseñas nuevas no coinciden.');
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      const r = await fetch('/api/cambiar-clave', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual, nueva }),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (r.ok) { location.href = '/'; return; }
      if (r.status === 401) { location.href = '/login.html'; return; }
      mostrar(cuerpo.error || 'No se pudo cambiar la contraseña.');
    } catch {
      mostrar('Sin conexión con el servidor.');
    } finally {
      boton.disabled = false;
      boton.textContent = 'Guardar contraseña';
    }
  });

  $('btn-salir').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } finally { location.href = '/login.html'; }
  });
  $('actual').focus();
})();
