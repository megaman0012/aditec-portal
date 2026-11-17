# Portal ADITEC (beta) — aditec-portal

Sitio web interno de una sola página con login que muestra el tablero "ADITEC ECUATORIANA –
Rentabilidad por empleado / Resumen nacional" con datos REALES del ERP MBA3, con filtros de fecha.
Primera pieza de una plataforma por módulos (cobranza, KPIs, validación de transferencias,
facturas de proveedores). Hoy SOLO consultas de lectura. Responsable: Luis Guzmán, Jefe de Sistemas.

Trabajo por fases: al terminar cada fase, resumir, mostrar evidencias (sin secretos) y DETENERSE
hasta "continúa". Ante algo ambiguo o destructivo, preguntar antes.

## Stack
- Node.js 20 SIN frameworks en backend (http nativo + crypto). Única lib de frontend: Chart.js 4
  en `public/vendor/chart.umd.min.js` (descargada una vez; nada de CDN en runtime).
- Docker + docker compose, proyecto "aditec-portal", red externa `aditec-net`, puerto 8090.
- Caché en `./data` (volumen rw). Configuración en `./config` (ro). Secretos SOLO en `.env`.

## MBA3 (solo red interna)
- Base: http://192.168.1.203:8081
- Login: `POST /ws2_mba3_serv_/login_servicio` JSON `{"codigo","pwd"}` -> `{"jwt"}`.
- Consulta: `POST /ws2_mba3_serv_Consultas_Externas_/`, header `Authorization: <jwt>` (SIN Bearer),
  multipart/form-data: select, from, where, limit.
- Sesión ~10 min: renovar a los 8 min o ante "Unauthorized" (reintentar 1 vez).
- Respuestas: array = filas | `{"error":"009",...}` = VACÍO (no es error) | XML 4D `<contents>` = error.
  El código HTTP no es fiable (MBA3 devuelve 200 incluso a GET).
- ORDA: `= != < > <= >= AND OR`. NO `<>` ni `{d '...'}`. Fechas 'AAAA-MM-DD'. EMPRESA/CORP = 'ADITE'.

## REGLA CRÍTICA: VETO DE IP
- UNA petición a la vez (cola serial global), pausa mínima 1500 ms (`MBA3_PAUSA_MS`, piso duro en código).
- NUNCA `Promise.all` ni peticiones paralelas contra MBA3.
- Usuarios del portal NUNCA disparan consultas a MBA3: la web lee solo la caché; el sincronizador
  es el único que habla con MBA3.
- Respuestas raras repetidas -> detener sincronizador y avisar (posible veto; se desbloquea en
  MBA3 > Servicios de Acceso Externo > IPs).

## Seguridad
- Nunca imprimir, registrar ni commitear contraseñas o JWT. `.env` en `.gitignore`, chmod 600.
- Sin cédulas ni datos personales innecesarios en config ni en la web.
- Solo LECTURA. Prohibido `/ws2_mba3_serv_api_/...`.

## Tablas
- CLNT_Factura_Principal: EMPRESA, ANIO, MES, FECHA_FACTURA, VENDEDOR, ORIGEN, TIPO_DOCUMENTO ('FACT'),
  SUBTOTAL_CON_IVA, SUBTOTAL_SIN_IVA, VALOR_FACTURA, VALOR_TOTAL_DESCUENTO, TOTAL_DEVOLUCION, ANULADA.
- INVT_Producto_Movimientos: CORP, COD_SALESMAN, ADJUSTMENT_TYPE ('FT'), TRANS_DATE, QUANTITY,
  TOT_RETURN_UNIT, TRANS_COST (unitario), NET_LINE_TOTAL, Anulada.
- CONT_Asiento_Detalle: GL_ACCOUNT_CODE, DEBIT_AMOUNT, CREDIT_AMOUNT, DEPARTMENT_CODE,
  PROFIT_CENTER_CODE, POST_TO_DATE, ORIGIN.

## Fórmulas (src/calc/metrics.js, puras)
VB=(SUBTOTAL_CON_IVA+SUBTOTAL_SIN_IVA)+VALOR_TOTAL_DESCUENTO [validar Fase 4] · DD=DESC+DEVOL ·
VN=VB-DD · CV=Σ(QUANTITY-TOT_RETURN_UNIT)*TRANS_COST (FT no anuladas) · UB=VN-CV · GT=GN+GG ·
UN=UB-GT · U=VN-GT · RUN=UN/VN · R=U/VN · %D=DD/VB · %C=CV/VN · %MB=UB/VN · %Part=asesor/total.
Excluir ANULADA y no-'FACT'. División entre 0 -> null ("—").

## Decisiones tomadas
- Host real: CentOS Stream 10 (no 9), SELinux Enforcing -> volúmenes con `:Z`. Docker CE 29 (repo el10).
- Ubicación: `/home/aditec/Documentos/dt360crm/aditec-portal` (aprobado; no /opt).
- Firewall: 8090/tcp solo desde 192.168.1.0/24 (rich rule).
- Contenedor: usuario `node`, rootfs read-only, cap_drop ALL, no-new-privileges.
- Usuarios del portal en `config/usuarios.json` con hash scrypt (no versionado).
- Chart.js v4.4.7, sha256 `2812cb8825fdc57469eb2f7bb055e9429244e599920511ee477e828499b632cb`
  (el bundle `chart.umd.js` de 4.4.7 ya viene minificado; se guardó como `chart.umd.min.js`).

- Sincronizador apagado salvo `SYNC_ACTIVO=true` en .env. Lock `data/mba3.lock` + `data/mba3-ultima.json`
  garantizan una petición a la vez y la pausa también entre procesos (servidor y scripts).
- Detención persistente en `data/SYNC_DETENIDO.json`: 3 respuestas raras seguidas, o al instante con
  `{"error":"003","respuesta":"IP No Autorizada"}`. Nada vuelve a llamar a MBA3 hasta `sync-manual.js --reanudar`.
- 2026-11-17: primera prueba real -> error 003 "IP No Autorizada" para 192.168.1.50 (1 sola petición).

## Comandos
- `docker compose up -d --build` · `docker compose logs -f portal` · `curl localhost:8090/health`
- Tests: `docker run --rm -v "$PWD":/app:Z -w /app node:20-alpine node --test test/`
- Crear usuario: `docker compose run --rm -it -v ./config:/app/config:Z portal node scripts/crear-usuario.js <usuario> "<Nombre>" [lector|admin]`
