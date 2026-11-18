// Límite de intentos de login por IP: 5 fallos en 15 min -> bloqueo 15 min.
export function crearRateLimit({ maxFallos = 5, ventanaMs = 15 * 60_000, bloqueoMs = 15 * 60_000, ahora = () => Date.now() } = {}) {
  const ips = new Map(); // ip -> { fallos: number[], bloqueadoHasta: number }

  function limpiar(ip) {
    const e = ips.get(ip);
    if (!e) return null;
    const t = ahora();
    e.fallos = e.fallos.filter((x) => t - x < ventanaMs);
    if (!e.fallos.length && e.bloqueadoHasta <= t) { ips.delete(ip); return null; }
    return e;
  }

  return {
    // ms restantes de bloqueo (0 = permitido)
    bloqueado(ip) {
      const e = limpiar(ip);
      return e && e.bloqueadoHasta > ahora() ? e.bloqueadoHasta - ahora() : 0;
    },
    fallo(ip) {
      const e = limpiar(ip) ?? { fallos: [], bloqueadoHasta: 0 };
      e.fallos.push(ahora());
      if (e.fallos.length >= maxFallos) {
        e.bloqueadoHasta = ahora() + bloqueoMs;
        e.fallos = [];
      }
      ips.set(ip, e);
      return e.bloqueadoHasta > ahora();
    },
    exito(ip) { ips.delete(ip); },
  };
}
