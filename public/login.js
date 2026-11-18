// Login del Portal ADITEC (sin scripts inline por la CSP).
(function () {
  'use strict';
  const form = document.getElementById('form-login');
  const error = document.getElementById('login-error');
  const boton = document.getElementById('btn-ingresar');

  function mostrarError(msg) {
    error.textContent = msg;
    error.hidden = false;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.hidden = true;
    const usuario = form.usuario.value.trim();
    const password = form.password.value;
    if (!usuario || !password) return mostrarError('Ingresa usuario y contraseña.');
    boton.disabled = true;
    boton.textContent = 'Ingresando…';
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, password }),
        credentials: 'same-origin',
      });
      if (r.ok) {
        const datos = await r.json().catch(() => ({})); // consumir la respuesta antes de navegar
        if (datos.debeCambiar) { location.href = '/cambiar-clave.html'; return; }
        const destino = new URLSearchParams(location.search).get('volver');
        location.href = destino && destino.startsWith('/?') ? destino : '/';
        return;
      }
      if (r.status === 429) {
        const seg = Number(r.headers.get('Retry-After')) || 900;
        mostrarError(`Demasiados intentos fallidos. Espera ${Math.ceil(seg / 60)} minutos e inténtalo otra vez.`);
      } else if (r.status === 401) {
        mostrarError('Usuario o contraseña incorrectos.');
        form.password.value = '';
        form.password.focus();
      } else {
        mostrarError('No se pudo ingresar. Inténtalo de nuevo.');
      }
    } catch {
      mostrarError('Sin conexión con el servidor.');
    } finally {
      boton.disabled = false;
      boton.textContent = 'Ingresar';
    }
  });

  form.usuario.focus();
})();
