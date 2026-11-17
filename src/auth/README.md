# auth/

- `passwords.js` — hash/verificación scrypt (listo).
- Pendiente Fase 5: `users.js` (lee config/usuarios.json), `sessions.js` (cookie HttpOnly firmada
  con SESSION_SECRET, expira en SESSION_HORAS), `ratelimit.js` (intentos de login por IP).
