// Tablero (Fase 5). Por ahora: confirma que Chart.js se sirve localmente (sin CDN).
document.getElementById('chart-status').textContent =
  typeof window.Chart === 'function' ? `Chart.js ${window.Chart.version} cargado localmente` : 'Chart.js NO cargó';
