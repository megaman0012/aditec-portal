# Portal ADITEC (beta) — aditec-portal

Sitio web interno de una sola página con login que muestra el tablero "ADITEC ECUATORIANA –
Rentabilidad por empleado / Resumen nacional" con datos REALES del ERP MBA3, con filtros de fecha.
Primera pieza de una plataforma por módulos (cobranza, KPIs, validación de transferencias,
facturas de proveedores). Hoy SOLO consultas de lectura. Responsable: Luis Guzmán, Jefe de Sistemas.

Trabajo por fases: al terminar cada fase, resumir, mostrar evidencias (sin secretos) y DETENERSE
hasta "continúa". Ante algo ambiguo o destructivo, preguntar antes. Ver README.md para operación.

## Reglas no negociables
- **SOLO LECTURA** en MBA3. Prohibido `/ws2_mba3_serv_api_/...` (el cliente lo bloquea).
- **Anti-veto de IP**: cola serial global, UNA petición a la vez, pausa ≥ 1500 ms (`MBA3_PAUSA_MS`, piso
  duro en `src/config.js` y en el cliente). NUNCA `Promise.all` ni paralelismo contra MBA3.
- La web lee SOLO la caché. El sincronizador es el único que habla con MBA3 (la recarga admin solo encola).
- Respuestas raras repetidas -> se detiene y avisa (posible veto; se desbloquea en MBA3 > Servicios de
  Acceso Externo > IPs).
- Nunca imprimir/registrar/commitear contraseñas, JWT ni cookies. Secretos SOLO en `.env` (600, en .gitignore).
- Sin cédulas ni datos personales innecesarios en config, caché ni web.

## Stack
Node.js 20 sin frameworks (http + crypto nativos) · Chart.js 4.4.7 local en `public/vendor/` (sin CDN) ·
Docker compose, servicio `aditec-portal`, red externa `aditec-net`, puerto 8090 ·
Host CentOS Stream 10 (no 9), SELinux Enforcing (volúmenes `:Z`), Docker CE 29 (repo el10).
Ubicación: `/home/aditec/Documentos/dt360crm/aditec-portal`. Servidor `192.168.1.50` (IP fija vía `ops/ip-fija.sh`).

## MBA3 (192.168.1.203:8081)
- Login `POST /ws2_mba3_serv_/login_servicio` `{codigo,pwd}` -> `{jwt}`; renovar a los 8 min o ante
  Unauthorized (1 reintento). Consulta `POST /ws2_mba3_serv_Consultas_Externas_/`, `Authorization: <jwt>`
  sin Bearer, multipart select/from/where/limit.
- Respuestas: array = filas · `{"error":"009"}` = vacío · `{"error":"003","respuesta":"IP No Autorizada"}` =
  detener YA · XML 4D `<contents>` = error. El código HTTP no es fiable (devuelve 200 a casi todo).
- ORDA: `= != < > <= >= AND OR`; no `<>` ni `{d '...'}`; fechas 'AAAA-MM-DD'; EMPRESA/CORP = 'ADITE'.
- **Tope silencioso de 3000 filas por respuesta** aunque se pida más: `consultarRango` parte el rango
  cuando llega a 3000 (TOPE_SERVIDOR en `src/mba3/queries.js`).
- **Asientos de NOMINA vienen con GL_ACCOUNT_TYPE vacío**: filtrar por rango de cuenta
  (`GL_ACCOUNT_CODE >= '5' AND < '8'`), nunca por tipo 'G'.
- Tipos reales: fechas texto `AAAA-MM-DD`; ANULADA/Anulada booleanos; VENDEDOR = COD_SALESMAN (formato `XX-YY`);
  ORIGEN `PRI`/`UIO`; solo hay `FACT` en CLNT_Factura_Principal; NET_LINE_TOTAL = LINE_TOTAL (antes de devolución).

## Decisiones de datos (Fase 4, validadas contra oct-2026)
- Cuadre Σ NET_LINE_TOTAL (FT) vs Σ subtotal facturas: **0,00 %** en los 17 vendedores.
  TOTAL_DEVOLUCION = TOT_RETURN_AMOUNT al centavo. Σ Q×TRANS_COST = costo contable "FACTURA CLIENTE".
- **VB = subtotal + descuento (opción A)**. VALOR_FACTURA incluye IVA (15 % y 5 %): descartado.
- Anomalía: descuento == VALOR_FACTURA (42 facturas oct-2026, MA-DG/MA-DO y devoluciones totales).
  Se guarda `descAnomalo`; `config/reglas.json` `vb_ignorar_descuento_igual_valor_factura` (false, pendiente).
- Gastos (propuesta, `config/gastos.json` confirmado=false): 6111 nómina (GP.*), 6112 generales (GG.*),
  excluir 61120200/61120201; 7111/7112 y 51xx fuera. DEPARTMENT_CODE ≈ sucursal (1 PRI, 2 UIO, 3 ?),
  PROFIT_CENTER_CODE 01 comercial, 02 admin, 00 general, 50-52 producción. Sin asesor en gastos ->
  reparto por dep/centro y prorrateo por VN. Sin confirmar -> GN/GG/GT/UN/U/RUN/R = "Pendiente de configurar".
- `config/vendedores.json`: arreglo [{codigo, alias, nombre, sucursal, area, activo}]; sin sucursal ->
  se usa el ORIGEN predominante.

## Motor de datos (Fase 5)
- Caché por MES `data/cache/AAAA-MM.json`: filas por día/vendedor {fecha, vendedor, sucursal(ORIGEN),
  sub, desc, descAnomalo, dev, costo, gastoNomina, gastoGeneral(null), nFacturas} + `pool` de gastos por
  día/dep/pc/cuenta. Montos con 4 decimales. Sin filas crudas.
- Reparto de gastos en `calcular()` sobre el rango pedido (cambiar gastos.json no requiere re-descargar).
- Plan de pasada: mes en curso + cerrados faltantes del más reciente al más antiguo. Meses cerrados fijos
  (recarga manual). Si una tabla falla, se conserva el archivo anterior. `data/estado.json` con métricas.
- `calcular()` puro: filtros, % participación vs nacional, promedios, semáforo (`config/umbrales.json`),
  porSucursal. `src/data/repo.js` añade comparativo (mismo rango del año anterior) y cobertura.
- Un mes completo ≈ 4–10 peticiones y 10–30 s.

## Autenticación y API (Fase 6)
- usuarios.json {usuario, nombre, rol admin|gerencia, hash, salt} (scrypt asíncrono); se relee sin reinicio.
- Cookie `aditec_sid` HttpOnly, SameSite=Strict, HMAC-SHA256, SESSION_HORAS; Secure con COOKIE_SECURE=true.
  El rol se lee de usuarios.json en cada petición; logout revoca el jti (en memoria).
- Rate limit login 5 fallos/IP/15 min -> 429 15 min. POST con Origin ajeno -> 403. `/` sin sesión -> 302 login.
- Endpoints: /api/login, logout, me, filtros, tablero, tablero.csv (`;`, coma decimal, BOM), estado (admin),
  POST /api/admin/recargar?mes= (admin, encola), /health. Máx. 24 meses por consulta.

## Frontend (Fase 7)
- JS vanilla + Chart.js; sin scripts/estilos inline (CSP); CSSOM (`el.style.x`) sí permitido.
- Filtros en la URL (`?desde&hasta&sucursal&area&vendedores&comparar=1`). Comparar no vuelve a pedir datos.
- No reemplazar `Chart.defaults.animation` completo (rompe el easing: "this._fn is not a function").
- Playwright: no usar `wait_for_function` con string (la CSP bloquea eval); usar selectores.

## Publicación (Fase 8)
- Imagen sin npm install, TZ America/Guayaquil (Node usa ICU; `date` de busybox muestra UTC), usuario node,
  código root:root, rootfs read-only, cap_drop ALL, mem 512m (heap 384m), logs json-file 10m×3.
- data/ rw, config/ **ro** (usuarios con contenedor aparte). Sin Cross-Origin-Opener-Policy (Chrome la
  ignora con error fuera de HTTPS).
- Firewall: 8090/tcp solo 192.168.1.0/24 (`ops/firewall-8090.sh`). Proxy inverso preparado (comentado en
  compose + `ops/proxy-ejemplo.md`); TRUST_PROXY + TRUSTED_PROXY_IPS para IP real del cliente.
- SYNC_ACTIVO=true desde 2026-11-18 (historia desde 2025-01-01).
- Repo GitHub `megaman0012/aditec-portal` es PÚBLICO; el responsable aceptó publicar config y cifras
  de referencia. No subir nunca .env, usuarios.json ni data/.

## Comandos
- `docker compose up -d --build` · `docker compose logs -f aditec-portal` · `curl localhost:8090/health`
- Tests: `docker run --rm -v "$PWD":/app:Z -w /app node:20-alpine node --test test/`
- Usuario: `docker run --rm -it --user 1000:1000 -v "$PWD":/app:Z -w /app node:20-alpine node scripts/crear-usuario.js <usuario> "<Nombre>" admin|gerencia`
- Sync: `docker compose exec aditec-portal node scripts/sync-manual.js --mes=AAAA-MM | --estado | --reanudar`
- Dev: `docker run --rm -it -p 127.0.0.1:8091:8091 -v "$PWD":/app:ro,Z -w /app node:20-alpine node scripts/dev.js`
- Chart.js v4.4.7 sha256 `2812cb8825fdc57469eb2f7bb055e9429244e599920511ee477e828499b632cb`.
