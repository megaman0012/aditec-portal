// Tablero "ADITEC ECUATORIANA – Rentabilidad por empleado" (JS vanilla + Chart.js local).
// Sin scripts inline (CSP). Toda la data viene de /api/* (que lee solo la caché).
(function () {
  'use strict';

  // ------------------------------------------------------------------ formato
  const TZ = 'America/Guayaquil';
  const nfUSD = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nfUSD0 = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const nfCompacto = new Intl.NumberFormat('es-EC', { notation: 'compact', maximumFractionDigits: 1 });
  const nfPct = new Intl.NumberFormat('es-EC', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nfPct2 = new Intl.NumberFormat('es-EC', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nfNum1 = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const RAYA = '—';
  const PENDIENTE = 'Pendiente de configurar';

  // Negativos como "-$1.171,41" (es-EC formatea "$-1.171,41")
  const conSigno = (nf, v) => (v == null ? RAYA : `${v < 0 ? '-' : ''}${nf.format(Math.abs(v))}`);
  const usd = (v) => conSigno(nfUSD, v);
  const usd0 = (v) => conSigno(nfUSD0, v);
  const pct = (v) => (v == null ? RAYA : nfPct.format(v));
  const pct2 = (v) => (v == null ? RAYA : nfPct2.format(v));
  const ejeUSD = (v) => `${v < 0 ? '-' : ''}$${nfCompacto.format(Math.abs(v))}`;
  const fechaDMA = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : RAYA);
  const fechaHora = (iso) => (iso ? new Intl.DateTimeFormat('es-EC', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : RAYA);
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mesCorto = (m) => `${MESES[Number(m.slice(5, 7)) - 1]}-${m.slice(0, 4)}`;

  // ------------------------------------------------------------------ rubros
  // tipo: usd | pct · gasto: depende de gastos (puede estar "Pendiente de configurar") · sem: semáforo
  const R = {
    vb: { t: 'Ventas brutas', tipo: 'usd' },
    dd: { t: 'Descuentos y devoluciones', tipo: 'usd' },
    vn: { t: 'Ventas netas', tipo: 'usd' },
    cv: { t: 'Costo de ventas', tipo: 'usd' },
    ub: { t: 'Utilidad bruta', tipo: 'usd' },
    gn: { t: 'Gastos de nómina', tipo: 'usd', gasto: true },
    gg: { t: 'Gastos generales', tipo: 'usd', gasto: true },
    gt: { t: 'Gastos totales', tipo: 'usd', gasto: true },
    un: { t: 'Utilidad neta', tipo: 'usd', gasto: true },
    u: { t: 'Utilidad', tipo: 'usd', gasto: true, nota: 'Ventas netas − gastos' },
    run: { t: 'Rentabilidad utilidad neta', tipo: 'pct', gasto: true, sem: 'rentabilidad' },
    r: { t: 'Rentabilidad', tipo: 'pct', gasto: true, nota: 'Utilidad / ventas netas' },
    pctD: { t: '% Descuentos', tipo: 'pct', sem: 'descuentos' },
    pctC: { t: 'Costo relación ventas', tipo: 'pct', sem: 'costo' },
  };
  const FILAS_TABLA = ['vb', 'dd', 'vn', 'cv', 'ub', 'gn', 'gg', 'un', 'run', 'pctD', 'pctC'];
  const GRAFICOS = ['vb', 'dd', 'vn', 'cv', 'ub', 'gt', 'un', 'u', 'run', 'r', 'pctD', 'pctC'];
  const fmt = (k, v) => (R[k].tipo === 'pct' ? pct(v) : usd(v));

  const AZUL = '#1E88E5';
  const AZUL_RESALTE = '#0D47A1';
  const GRIS = '#CFD8DC';
  const PALETA_DONA = ['#1E88E5', '#8BC34A', '#FFB300', '#26A69A', '#AB47BC', '#EF5350', '#78909C'];

  // ------------------------------------------------------------------ estado
  const $ = (id) => document.getElementById(id);
  const estado = {
    filtros: null, // { sucursales, areas, vendedores, rango, maxMeses }
    datos: null, // respuesta de /api/tablero
    seleccionAsesores: new Set(),
    graficos: [],
    resaltado: null,
    me: null,
  };

  // ------------------------------------------------------------------ API
  async function api(ruta, opciones = {}) {
    const r = await fetch(ruta, { credentials: 'same-origin', ...opciones });
    if (r.status === 401) {
      location.href = `/login.html?volver=${encodeURIComponent(location.pathname + location.search)}`;
      throw new Error('Sesión expirada');
    }
    if (r.status === 403 && r.headers.get('X-Cambiar-Clave')) {
      location.href = '/cambiar-clave.html';
      throw new Error('Cambio de contraseña requerido');
    }
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(cuerpo.error || `Error ${r.status}`), { status: r.status });
    return cuerpo;
  }

  // ------------------------------------------------------------------ fechas
  const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const finDeMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  function atajo(nombre) {
    const hoy = hoyISO();
    const [y, m] = hoy.split('-').map(Number);
    switch (nombre) {
      case 'mes': return [iso(y, m, 1), hoy];
      case 'mesAnterior': { const yy = m === 1 ? y - 1 : y; const mm = m === 1 ? 12 : m - 1; return [iso(yy, mm, 1), iso(yy, mm, finDeMes(yy, mm))]; }
      case 'trimestre': { const mi = Math.floor((m - 1) / 3) * 3 + 1; return [iso(y, mi, 1), hoy]; }
      case 'ytd': return [iso(y, 1, 1), hoy];
      case 'anioAnterior': return [iso(y - 1, 1, 1), iso(y - 1, 12, 31)];
      default: return null;
    }
  }

  // ------------------------------------------------------------------ URL <-> filtros
  function leerURL() {
    const q = new URLSearchParams(location.search);
    return {
      desde: q.get('desde'), hasta: q.get('hasta'),
      sucursal: q.get('sucursal') || '', area: q.get('area') || '',
      vendedores: (q.get('vendedores') || '').split(',').filter(Boolean),
      comparar: q.get('comparar') === '1',
    };
  }
  function filtrosFormulario() {
    const todos = estado.filtros.vendedores.length;
    const sel = [...estado.seleccionAsesores];
    return {
      desde: $('f-desde').value, hasta: $('f-hasta').value,
      sucursal: $('f-sucursal').value, area: $('f-area').value,
      vendedores: sel.length && sel.length < todos ? sel : [],
      comparar: $('f-comparar').checked,
    };
  }
  function queryDe(f, { conComparar = true } = {}) {
    const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
    if (f.sucursal) q.set('sucursal', f.sucursal);
    if (f.area) q.set('area', f.area);
    if (f.vendedores.length) q.set('vendedores', f.vendedores.join(','));
    if (conComparar && f.comparar) q.set('comparar', '1');
    return q.toString();
  }
  function aplicarAFormulario(f) {
    $('f-desde').value = f.desde;
    $('f-hasta').value = f.hasta;
    $('f-sucursal').value = f.sucursal;
    $('f-area').value = f.area;
    $('f-comparar').checked = f.comparar;
    estado.seleccionAsesores = new Set(f.vendedores.length ? f.vendedores : estado.filtros.vendedores.map((v) => v.codigo));
    pintarListaAsesores();
    marcarAtajo();
  }
  function marcarAtajo() {
    for (const b of document.querySelectorAll('[data-atajo]')) {
      const r = atajo(b.dataset.atajo);
      b.classList.toggle('activo', r[0] === $('f-desde').value && r[1] === $('f-hasta').value);
    }
  }

  // ------------------------------------------------------------------ selector múltiple de asesores
  const multi = $('f-asesores');
  const multiBoton = multi.querySelector('.multi-boton');
  const multiPanel = multi.querySelector('.multi-panel');
  const multiBuscar = multi.querySelector('.multi-buscar');
  const multiLista = multi.querySelector('.multi-lista');

  function textoMulti() {
    const n = estado.seleccionAsesores.size;
    const total = estado.filtros.vendedores.length;
    multiBoton.textContent = n === total ? `Todos (${total})` : n === 0 ? 'Ninguno' : `${n} de ${total}`;
  }
  function pintarListaAsesores() {
    const filtro = multiBuscar.value.trim().toLowerCase();
    multiLista.replaceChildren();
    for (const v of estado.filtros.vendedores) {
      const texto = `${v.alias} ${v.codigo} ${v.nombre}`.toLowerCase();
      if (filtro && !texto.includes(filtro)) continue;
      const li = document.createElement('li');
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = v.codigo;
      cb.checked = estado.seleccionAsesores.has(v.codigo);
      cb.addEventListener('change', () => {
        if (cb.checked) estado.seleccionAsesores.add(v.codigo); else estado.seleccionAsesores.delete(v.codigo);
        textoMulti();
      });
      const nombre = document.createElement('span');
      nombre.textContent = v.nombre ? `${v.alias} · ${v.nombre}` : v.alias;
      const det = document.createElement('span');
      det.className = 'detalle';
      det.textContent = v.sucursal || '';
      label.append(cb, nombre, det);
      li.append(label);
      multiLista.append(li);
    }
    textoMulti();
  }
  multiBoton.addEventListener('click', () => {
    const abrir = multiPanel.hidden;
    multiPanel.hidden = !abrir;
    multiBoton.setAttribute('aria-expanded', String(abrir));
    if (abrir) multiBuscar.focus();
  });
  multiBuscar.addEventListener('input', pintarListaAsesores);
  multi.querySelector('[data-accion="todos"]').addEventListener('click', () => {
    estado.seleccionAsesores = new Set(estado.filtros.vendedores.map((v) => v.codigo));
    pintarListaAsesores();
  });
  multi.querySelector('[data-accion="ninguno"]').addEventListener('click', () => {
    estado.seleccionAsesores.clear();
    pintarListaAsesores();
  });
  document.addEventListener('click', (ev) => {
    if (!multi.contains(ev.target)) { multiPanel.hidden = true; multiBoton.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') multiPanel.hidden = true; });

  // ------------------------------------------------------------------ avisos / toast
  function aviso(tipo, html) {
    const d = document.createElement('div');
    d.className = `aviso ${tipo}`;
    d.textContent = html;
    $('avisos').append(d);
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  // ------------------------------------------------------------------ esqueleto (carga)
  function pintarEsqueleto() {
    document.body.classList.add('cargando');
    const kpis = $('kpis');
    kpis.replaceChildren();
    for (let i = 0; i < 5; i++) {
      const k = document.createElement('div');
      k.className = 'kpi';
      k.innerHTML = '<div class="esqueleto esq-linea"></div><div class="esqueleto esq-valor"></div><div class="esqueleto esq-linea"></div>';
      kpis.append(k);
    }
    destruirGraficos();
    const tab = $('tablero');
    tab.replaceChildren();
    tab.hidden = false;
    $('sin-datos').hidden = true;
    for (const k of ['centro', ...GRAFICOS]) {
      const c = document.createElement('div');
      c.className = k === 'centro' ? 'grafico centro' : 'grafico';
      c.style.gridArea = k;
      c.innerHTML = '<div class="esqueleto esq-linea"></div><div class="lienzo"><div class="esqueleto esq-bloque"></div></div>';
      tab.append(c);
    }
  }

  // ------------------------------------------------------------------ KPIs
  function variacion(k, actual, anterior, hayComp) {
    if (!hayComp || actual == null || anterior == null) return { texto: hayComp ? 'sin comparativo' : '', clase: '' };
    const malo = k === 'pctD'; // subir el % de descuentos es malo
    if (R[k].tipo === 'pct') {
      const d = (actual - anterior) * 100;
      const arriba = d >= 0;
      return { texto: `${arriba ? '▲' : '▼'} ${nfNum1.format(Math.abs(d))} pp vs año ant.`, clase: arriba !== malo ? 'sube' : 'baja' };
    }
    if (anterior === 0) return { texto: 'sin base comparable', clase: '' };
    const d = (actual - anterior) / Math.abs(anterior);
    const arriba = d >= 0;
    return { texto: `${arriba ? '▲' : '▼'} ${nfNum1.format(Math.abs(d) * 100)} % vs año ant.`, clase: arriba !== malo ? 'sube' : 'baja' };
  }

  function pintarKPIs(d, comparar) {
    const kpis = $('kpis');
    kpis.replaceChildren();
    const t = d.filtro;
    const c = d.comparativo.totalFiltro;
    const hayComp = comparar && d.comparativo.cobertura.presentes.length > 0;
    const pendiente = !!d.meta.pendientes.gastos;
    const lista = [
      ['vn', 'Ventas netas'], ['ub', 'Utilidad bruta'], ['un', 'Utilidad neta'], ['run', 'Rentabilidad'], ['pctD', '% Descuentos'],
    ];
    for (const [k, titulo] of lista) {
      const div = document.createElement('div');
      div.className = 'kpi';
      const sem = R[k].sem && t.semaforo ? t.semaforo[R[k].sem] : null;
      if (sem) div.classList.add(`sem-${sem}`);
      const h = document.createElement('div');
      h.className = 'titulo';
      h.textContent = titulo;
      const v = document.createElement('div');
      v.className = 'valor';
      const pend = R[k].gasto && pendiente;
      if (pend) { v.classList.add('pendiente'); v.textContent = PENDIENTE; } else v.textContent = R[k].tipo === 'pct' ? pct2(t[k]) : usd0(t[k]);
      const vr = document.createElement('div');
      vr.className = 'variacion';
      if (!pend) {
        const x = variacion(k, t[k], c ? c[k] : null, hayComp);
        if (x.clase) { const s = document.createElement('span'); s.className = x.clase; s.textContent = x.texto; vr.append(s); } else vr.textContent = x.texto;
      } else vr.textContent = 'Falta confirmar gastos.json';
      div.append(h, v, vr);
      kpis.append(div);
    }
  }

  // ------------------------------------------------------------------ gráficos
  function destruirGraficos() {
    for (const g of estado.graficos) g.destroy();
    estado.graficos = [];
  }

  Chart.defaults.font.family = getComputedStyle(document.documentElement).fontFamily;
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#546E7A';
  Chart.defaults.animation.duration = 300; // no reemplazar el objeto: se perdería la función de easing

  function tarjetaGrafico(k, titulo, totalTexto) {
    const c = document.createElement('div');
    c.className = 'grafico';
    c.style.gridArea = k;
    const h = document.createElement('h3');
    h.textContent = titulo;
    const t = document.createElement('div');
    t.className = 'total';
    t.textContent = totalTexto;
    const l = document.createElement('div');
    l.className = 'lienzo';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${titulo} por asesor`);
    l.append(canvas);
    c.append(h, t, l);
    return { c, canvas };
  }

  function graficoBarras(k, d, comparar) {
    const def = R[k];
    const pendiente = def.gasto && !!d.meta.pendientes.gastos;
    const total = d.filtro[k];
    const { c, canvas } = tarjetaGrafico(k, def.t, pendiente ? '' : `Total: ${fmt(k, total)}${def.nota ? ` · ${def.nota}` : ''}`);
    $('tablero').append(c);
    if (pendiente) {
      const o = document.createElement('div');
      o.className = 'pendiente-overlay';
      o.textContent = `${PENDIENTE} (gastos.json)`;
      c.append(o);
      return;
    }
    const asesores = d.asesores;
    const etiquetas = asesores.map((a) => a.alias);
    const datasets = [{
      label: 'Periodo',
      data: asesores.map((a) => a[k]),
      backgroundColor: asesores.map((a) => (a.asesor === estado.resaltado ? AZUL_RESALTE : AZUL)),
      borderRadius: 3,
      maxBarThickness: 26,
    }];
    if (comparar) {
      datasets.push({
        label: 'Año anterior',
        data: asesores.map((a) => d.comparativo.porAsesor[a.asesor]?.[k] ?? null),
        backgroundColor: GRIS,
        borderRadius: 3,
        maxBarThickness: 26,
      });
    }
    const g = new Chart(canvas, {
      type: 'bar',
      data: { labels: etiquetas, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const a = asesores[items[0].dataIndex];
                return a.nombre ? `${a.alias} · ${a.nombre}` : a.alias;
              },
              label: (item) => {
                const a = asesores[item.dataIndex];
                const valor = fmt(k, item.raw);
                if (item.datasetIndex === 1) return `Año anterior: ${valor}`;
                const part = def.tipo === 'usd' && a.part && a.part[k] != null ? ` · ${pct(a.part[k])} del total nacional` : '';
                return `${valor}${part}`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 60, minRotation: 0, font: { size: 10 } } },
          y: {
            beginAtZero: true,
            grid: { color: '#ECEFF1' },
            ticks: { callback: (v) => (def.tipo === 'pct' ? nfPct.format(v) : ejeUSD(v)) },
          },
        },
        onClick: (_ev, elementos) => {
          if (!elementos.length) return;
          resaltarAsesor(asesores[elementos[0].index].asesor, true);
        },
        onHover: (ev, elementos) => { ev.native.target.style.cursor = elementos.length ? 'pointer' : 'default'; },
      },
    });
    estado.graficos.push(g);
  }

  function graficoCentro(d, comparar) {
    const c = document.createElement('div');
    c.className = 'grafico centro';
    c.style.gridArea = 'centro';
    const h = document.createElement('h2');
    h.textContent = 'RESUMEN NACIONAL';
    const ayuda = document.createElement('p');
    ayuda.className = 'ayuda';
    ayuda.textContent = `Participación en ventas netas por sucursal · ${fechaDMA(d.meta.desde)} – ${fechaDMA(d.meta.hasta)} · clic en una porción para filtrar`;
    const l = document.createElement('div');
    l.className = 'lienzo';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Participación en ventas netas por sucursal');
    l.append(canvas);

    const tot = document.createElement('div');
    tot.className = 'centro-totales';
    const n = d.filtro;
    const pend = !!d.meta.pendientes.gastos;
    for (const [t, v] of [
      ['Ventas netas', usd0(n.vn)], ['Utilidad bruta', usd0(n.ub)],
      ['Utilidad neta', pend ? PENDIENTE : usd0(n.un)], ['Margen bruto', pct(n.pctMB)],
    ]) {
      const x = document.createElement('div');
      const a = document.createElement('div'); a.className = 't'; a.textContent = t;
      const b = document.createElement('div'); b.className = 'v'; b.textContent = v;
      x.append(a, b);
      tot.append(x);
    }
    const ley = document.createElement('div');
    ley.className = 'leyenda-comp';
    ley.innerHTML = comparar
      ? '<span><i class="azul"></i>Periodo seleccionado</span><span><i class="gris"></i>Mismo periodo año anterior</span>'
      : '<span><i class="azul"></i>Periodo seleccionado</span>';
    c.append(h, ayuda, l, tot, ley);
    $('tablero').append(c);

    const suc = d.porSucursal.filter((s) => s.vn > 0);
    const g = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: suc.map((s) => s.sucursal),
        datasets: [{ data: suc.map((s) => s.vn), backgroundColor: suc.map((_, i) => PALETA_DONA[i % PALETA_DONA.length]), borderWidth: 2, borderColor: '#fff' }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, generateLabels: (chart) => chart.data.labels.map((lab, i) => ({
            text: `${lab}  ${pct(suc[i].part.vn)}`, fillStyle: chart.data.datasets[0].backgroundColor[i], strokeStyle: '#fff', index: i,
          })) } },
          tooltip: { callbacks: { label: (item) => `${item.label}: ${usd0(item.raw)} (${pct(suc[item.dataIndex].part.vn)} nacional · ${suc[item.dataIndex].nAsesores} asesores)` } },
        },
        onClick: (_ev, el) => {
          if (!el.length) return;
          const s = suc[el[0].index].sucursal;
          if (![...$('f-sucursal').options].some((o) => o.value === s)) return;
          $('f-sucursal').value = s;
          aplicar();
        },
        onHover: (ev, el) => { ev.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
      },
    });
    estado.graficos.push(g);
  }

  // ------------------------------------------------------------------ tabla
  function celda(tag, texto, clase) {
    const e = document.createElement(tag);
    e.textContent = texto;
    if (clase) e.className = clase;
    return e;
  }

  function pintarTabla(d) {
    const tabla = $('tabla');
    tabla.replaceChildren();
    const pend = !!d.meta.pendientes.gastos;
    const hayFiltro = d.meta.filtros.sucursales.length || d.meta.filtros.areas.length || d.meta.filtros.vendedores.length;

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.append(celda('th', 'Rubro'));
    for (const a of d.asesores) {
      const th = celda('th', a.alias);
      th.dataset.asesor = a.asesor;
      th.title = [a.nombre, a.sucursal, a.area].filter(Boolean).join(' · ') || a.asesor;
      const sub = celda('span', a.sucursal || '', 'sub-cab');
      th.append(sub);
      th.addEventListener('click', () => resaltarAsesor(a.asesor, false));
      trh.append(th);
    }
    if (hayFiltro) trh.append(celda('th', 'TOTAL SELECCIÓN', 'col-total'));
    const thN = celda('th', 'TOTAL NACIONAL', 'col-total');
    trh.append(thN);
    const thP = celda('th', 'PROMEDIO', 'col-prom');
    thP.append(celda('span', d.promedio ? `${d.promedio.nAsesores} asesores` : '', 'sub-cab'));
    trh.append(thP);
    thead.append(trh);

    const tbody = document.createElement('tbody');
    for (const k of FILAS_TABLA) {
      const def = R[k];
      const tr = document.createElement('tr');
      tr.append(celda('td', def.t));
      const valor = (obj, esPromedio) => {
        if (def.gasto && pend) { const td = celda('td', 'Pendiente', 'pend'); td.title = `${PENDIENTE} (config/gastos.json)`; return td; }
        if (esPromedio && def.tipo === 'pct') return celda('td', RAYA, 'pend'); // un promedio de % no es representativo
        const td = celda('td', fmt(k, obj ? obj[k] : null));
        const sem = def.sem && obj && obj.semaforo ? obj.semaforo[def.sem] : null;
        if (sem) td.classList.add(`sem-${sem}`);
        return td;
      };
      for (const a of d.asesores) {
        const td = valor(a);
        td.dataset.asesor = a.asesor;
        if (def.tipo === 'usd' && a.part && a.part[k] != null && !(def.gasto && pend)) td.title = `${pct(a.part[k])} del total nacional`;
        tr.append(td);
      }
      if (hayFiltro) { const t = valor(d.filtro); t.classList.add('col-total'); tr.append(t); }
      const tn = valor(d.nacional); tn.classList.add('col-total'); tr.append(tn);
      const tp = valor(d.promedio, true); tp.classList.add('col-prom'); tr.append(tp);
      tbody.append(tr);
    }
    tabla.append(thead, tbody);
    $('btn-csv').href = `/api/tablero.csv?${queryDe(estado.ultimaConsulta, { conComparar: false })}`;
    if (estado.resaltado) resaltarAsesor(estado.resaltado, false, true);
  }

  function resaltarAsesor(codigo, desplazar, silencioso) {
    estado.resaltado = codigo;
    for (const e of document.querySelectorAll('#tabla .resaltado')) e.classList.remove('resaltado');
    const celdas = document.querySelectorAll(`#tabla [data-asesor="${CSS.escape(codigo)}"]`);
    for (const e of celdas) e.classList.add('resaltado');
    // resalta también la barra en todos los gráficos
    for (const g of estado.graficos) {
      if (g.config.type !== 'bar') continue;
      const ds = g.data.datasets[0];
      const asesores = estado.datos.asesores;
      ds.backgroundColor = asesores.map((a) => (a.asesor === codigo ? AZUL_RESALTE : AZUL));
      g.update('none');
    }
    if (desplazar && celdas.length) {
      $('tabla-tarjeta').scrollIntoView({ behavior: 'smooth', block: 'start' });
      const th = celdas[0];
      const cont = $('tabla-scroll');
      cont.scrollTo({ left: Math.max(0, th.offsetLeft - 260), behavior: 'smooth' });
    }
    if (!silencioso) {
      const a = estado.datos.asesores.find((x) => x.asesor === codigo);
      if (a) toast(`Asesor resaltado: ${a.alias}${a.nombre ? ` · ${a.nombre}` : ''}`);
    }
  }

  // ------------------------------------------------------------------ render principal
  function pintar(d, comparar) {
    document.body.classList.remove('cargando');
    $('actualizado').textContent = `Datos actualizados: ${fechaHora(d.meta.actualizado)}`;
    $('avisos').replaceChildren();

    const faltan = d.meta.pendientes.mesesSinDatos;
    if (faltan.length) {
      aviso('alerta', `Aún sin datos (sincronizándose o fuera de la historia) para: ${faltan.map(mesCorto).join(', ')}. Las cifras de esos meses no están incluidas.`);
    }
    if (d.meta.pendientes.gastos) {
      aviso('info', `Gastos de nómina y generales: ${PENDIENTE}. Hasta confirmar config/gastos.json se muestran ventas, costos y márgenes; utilidad neta y rentabilidad quedan pendientes.`);
    }
    if (comparar && d.comparativo.cobertura.faltantes.length) {
      const sinNada = !d.comparativo.cobertura.presentes.length;
      aviso('alerta', sinNada
        ? `Sin datos del mismo periodo del año anterior (${fechaDMA(d.comparativo.desde)} – ${fechaDMA(d.comparativo.hasta)}): no se muestran barras grises.`
        : `Comparativo incompleto: faltan ${d.comparativo.cobertura.faltantes.map(mesCorto).join(', ')}.`);
    }

    pintarKPIs(d, comparar);
    destruirGraficos();
    const tab = $('tablero');
    tab.replaceChildren();

    if (!d.asesores.length) {
      tab.hidden = true;
      $('tabla-tarjeta').hidden = true;
      $('sin-datos').hidden = false;
      $('sin-datos-detalle').textContent = `${fechaDMA(d.meta.desde)} – ${fechaDMA(d.meta.hasta)}: no hay ventas registradas${faltan.length ? ' o el periodo aún no se ha sincronizado' : ''}. Prueba con otro rango o quita los filtros.`;
      return;
    }
    tab.hidden = false;
    $('tabla-tarjeta').hidden = false;
    $('sin-datos').hidden = true;
    graficoCentro(d, comparar);
    for (const k of GRAFICOS) graficoBarras(k, d, comparar);
    pintarTabla(d);
  }

  let pedidoActual = 0;
  async function cargar(f, { empujarURL }) {
    const n = ++pedidoActual;
    if (empujarURL) history.pushState(null, '', `/?${queryDe(f)}`);
    estado.ultimaConsulta = f;
    pintarEsqueleto();
    try {
      const d = await api(`/api/tablero?${queryDe(f, { conComparar: false })}`);
      if (n !== pedidoActual) return; // llegó una respuesta vieja
      estado.datos = d;
      pintar(d, f.comparar);
    } catch (e) {
      if (n !== pedidoActual) return;
      document.body.classList.remove('cargando');
      $('avisos').replaceChildren();
      aviso('error', `No se pudo cargar el tablero: ${e.message}`);
      $('kpis').replaceChildren();
      $('tablero').replaceChildren();
    }
  }

  function aplicar() {
    const f = filtrosFormulario();
    if (!f.desde || !f.hasta) return toast('Indica las fechas Desde y Hasta.');
    if (f.desde > f.hasta) return toast('"Desde" debe ser anterior o igual a "Hasta".');
    if (estado.seleccionAsesores.size === 0) return toast('Selecciona al menos un asesor.');
    multiPanel.hidden = true;
    marcarAtajo();
    cargar(f, { empujarURL: true });
  }

  // ------------------------------------------------------------------ eventos
  $('filtros').addEventListener('submit', (ev) => { ev.preventDefault(); aplicar(); });
  for (const b of document.querySelectorAll('[data-atajo]')) {
    b.addEventListener('click', () => {
      const [d, h] = atajo(b.dataset.atajo);
      $('f-desde').value = d;
      $('f-hasta').value = h;
      aplicar();
    });
  }
  $('f-desde').addEventListener('change', marcarAtajo);
  $('f-hasta').addEventListener('change', marcarAtajo);
  $('f-comparar').addEventListener('change', () => {
    if (!estado.datos) return;
    const f = { ...estado.ultimaConsulta, comparar: $('f-comparar').checked };
    estado.ultimaConsulta = f;
    history.replaceState(null, '', `/?${queryDe(f)}`);
    pintar(estado.datos, f.comparar); // el comparativo ya viene en la respuesta: no hace falta pedir de nuevo
  });
  window.addEventListener('popstate', () => {
    const f = desdeURLoDefecto();
    aplicarAFormulario(f);
    cargar(f, { empujarURL: false });
  });
  $('btn-clave').addEventListener('click', () => { location.href = '/cambiar-clave.html'; });
  $('btn-salir').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } finally { location.href = '/login.html'; }
  });
  $('btn-recargar').addEventListener('click', async () => {
    const mes = ($('f-hasta').value || hoyISO()).slice(0, 7);
    if (!confirm(`¿Volver a descargar ${mesCorto(mes)} desde MBA3?\nSe encola y se procesa en segundo plano (una petición a la vez).`)) return;
    try {
      const r = await api(`/api/admin/recargar?mes=${mes}`, { method: 'POST' });
      toast(`Recarga de ${mesCorto(mes)} encolada (posición ${r.posicion}). Actualiza en unos minutos.`);
    } catch (e) {
      toast(`No se pudo encolar: ${e.message}`);
    }
  });

  // ------------------------------------------------------------------ inicio
  function desdeURLoDefecto() {
    const u = leerURL();
    if (u.desde && u.hasta) return u;
    // Por defecto: el último mes con datos (completo), o el mes en curso si no hay caché.
    const rango = estado.filtros.rango;
    let desde, hasta;
    if (rango) {
      const ultimo = estado.filtros.meses[estado.filtros.meses.length - 1];
      const [y, m] = ultimo.split('-').map(Number);
      desde = iso(y, m, 1);
      hasta = rango.hasta < iso(y, m, finDeMes(y, m)) ? rango.hasta : iso(y, m, finDeMes(y, m));
    } else {
      [desde, hasta] = atajo('mes');
    }
    return { ...u, desde, hasta };
  }

  function llenarSelect(sel, valores, vacioTitulo) {
    for (const v of valores) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.append(o);
    }
    if (!valores.length) { sel.disabled = true; sel.title = vacioTitulo; }
  }

  async function iniciar() {
    pintarEsqueleto();
    try {
      const [me, filtros] = await Promise.all([api('/api/me'), api('/api/filtros')]); // dos lecturas a la caché, no a MBA3
      estado.me = me;
      estado.filtros = filtros;
      $('usuario').textContent = me.nombre || me.usuario;
      $('btn-recargar').hidden = me.rol !== 'admin';
      llenarSelect($('f-sucursal'), filtros.sucursales, 'Completar sucursal en config/vendedores.json');
      llenarSelect($('f-area'), filtros.areas, 'Completar área en config/vendedores.json');
      if (filtros.rango) {
        $('f-desde').min = filtros.rango.desde;
        $('f-hasta').min = filtros.rango.desde;
      }
      const f = desdeURLoDefecto();
      aplicarAFormulario(f);
      history.replaceState(null, '', `/?${queryDe(f)}`);
      await cargar(f, { empujarURL: false });
    } catch (e) {
      document.body.classList.remove('cargando');
      aviso('error', `No se pudo iniciar el tablero: ${e.message}`);
    }
  }

  iniciar();
})();
