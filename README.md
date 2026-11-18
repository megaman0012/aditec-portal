# Portal ADITEC (beta) — Rentabilidad por empleado

Tablero interno **"ADITEC ECUATORIANA – Rentabilidad por empleado / Resumen nacional"** con datos
reales del ERP **MBA3**, filtros de fecha, sucursal, área y asesor, y comparativo contra el mismo
periodo del año anterior. Es la primera pieza de una plataforma por módulos. **Solo lectura.**

Responsable: Luis Guzmán, Jefe de Sistemas · Versión: `v0.1-beta`

---

## Arquitectura

```
 Navegador (LAN 192.168.1.0/24)                       Servidor CentOS Stream 10 (192.168.1.50)
 ──────────────────────────────                       ──────────────────────────────────────────
  login.html / index.html  ──HTTP :8090──►  contenedor aditec-portal (Node 20, sin frameworks)
  JS vanilla + Chart.js local                 │
                                              ├─ src/app.js      rutas, sesión, API JSON/CSV
                                              ├─ src/data/repo.js  LEE SOLO la caché ──┐
                                              ├─ src/calc/        fórmulas puras      │
                                              │                                        ▼
                                              │                              data/cache/AAAA-MM.json
                                              │                              data/estado.json
                                              │                                        ▲
                                              └─ src/sync/scheduler.js  ÚNICO que habla con MBA3
                                                     │  cola serial · 1 petición a la vez · pausa ≥ 1,5 s
                                                     ▼
                                       MBA3  http://192.168.1.203:8081  (consultas externas, solo lectura)
```

**Principios**
- **Anti-veto de IP**: MBA3 bloquea la IP si recibe muchas peticiones por segundo. Todo pasa por una
  cola serial global con pausa mínima de 1500 ms (piso en el código), un lock entre procesos
  (`data/mba3.lock`) y un freno automático: 3 respuestas raras seguidas o `error 003 IP No Autorizada`
  detienen el sincronizador (`data/SYNC_DETENIDO.json`) hasta reanudarlo a mano.
- **La web nunca consulta MBA3**: los usuarios solo leen la caché; el botón admin "Recargar mes" encola trabajo.
- **Caché agregada por mes**: por cada día y vendedor se guarda subtotal, descuento, devolución, costo y nº de
  facturas; los gastos se guardan por día/departamento/centro/cuenta. No se guardan facturas, clientes ni empleados.
- **Gastos configurables sin re-descargar**: la asignación de gastos a asesores se calcula al consultar
  según `config/gastos.json`.

**Fórmulas** (por asesor y periodo; divisiones entre 0 → "—")

| Rubro | Fórmula |
|---|---|
| VB Ventas brutas | (SUBTOTAL_CON_IVA + SUBTOTAL_SIN_IVA) + VALOR_TOTAL_DESCUENTO |
| DD Descuentos y devoluciones | VALOR_TOTAL_DESCUENTO + TOTAL_DEVOLUCION |
| VN Ventas netas | VB − DD |
| CV Costo de ventas | Σ (QUANTITY − TOT_RETURN_UNIT) × TRANS_COST (movimientos FT no anulados) |
| UB Utilidad bruta | VN − CV |
| GN / GG / GT | Gastos de nómina / generales / totales (CONT_Asiento_Detalle, `config/gastos.json`) |
| UN Utilidad neta · U Utilidad | UB − GT · VN − GT |
| RUN · R · %D · %C · %MB | UN/VN · U/VN · DD/VB · CV/VN · UB/VN |

Se excluyen facturas anuladas y documentos distintos de `FACT`.

---

## Estructura

| Ruta | Contenido |
|---|---|
| `src/app.js`, `src/http.js` | Servidor HTTP nativo, rutas, cabeceras de seguridad |
| `src/auth/` | Contraseñas scrypt, usuarios, sesiones firmadas, límite de intentos |
| `src/mba3/` | Cliente MBA3 (cola, JWT, parseo de respuestas) y consultas por rango |
| `src/sync/scheduler.js` | Sincronizador mensual |
| `src/calc/` | `agregar.js` (crudo → agregado) y `metrics.js` (fórmulas, semáforo, gastos) |
| `src/data/repo.js` | Lectura de caché + comparativo año anterior |
| `public/` | `login.html`, `index.html`, `app.js`, `styles.css`, `vendor/chart.umd.min.js` |
| `config/` | `vendedores.json`, `gastos.json`, `umbrales.json`, `reglas.json`, `usuarios.json` (no versionado) |
| `data/` | Caché y estado (no versionado) |
| `scripts/` | Operación y diagnóstico (ver abajo) |
| `ops/` | IP fija, firewall, ejemplo de proxy inverso |
| `test/` | 56 tests (`node:test`) + simulador de MBA3 |

---

## Operación

Todos los comandos desde `~/Documentos/dt360crm/aditec-portal`.

### Arrancar / actualizar / estado
```bash
docker compose up -d --build          # construir y levantar
docker compose ps                     # estado (debe decir healthy)
curl http://192.168.1.50:8090/health  # salud
```
Acceso: **http://192.168.1.50:8090** (solo red 192.168.1.0/24).

### Crear o cambiar un usuario
`config/` está montado de solo lectura en el portal, así que se usa un contenedor aparte.
La clave se pide oculta (mínimo 10 caracteres); no hace falta reiniciar.
```bash
docker run --rm -it --user 1000:1000 -v "$PWD":/app:Z -w /app node:20-alpine \
  node scripts/crear-usuario.js <usuario> "<Nombre visible>" admin|gerencia
```
Para quitar un usuario, borrar su entrada de `config/usuarios.json`.

### Recargar un mes desde MBA3
- Web (rol admin): botón **⟳ Recargar mes** (recarga el mes de la fecha "Hasta").
- Consola:
```bash
docker compose exec aditec-portal node scripts/sync-manual.js --mes=2026-10
docker compose exec aditec-portal node scripts/sync-manual.js --estado
```
Un mes completo ≈ 4–10 peticiones y 10–30 s.

### Si el sincronizador se detiene (posible veto)
1. Revisar en MBA3 > Servicios de Acceso Externo > IPs que `192.168.1.50` esté autorizada/desbloqueada.
2. `docker compose exec aditec-portal node scripts/sync-manual.js --reanudar`
3. `docker compose restart aditec-portal`

### Ver logs
```bash
docker compose logs -f aditec-portal                      # todo
docker compose logs aditec-portal | grep '\[sync\]'       # sincronizador
docker compose logs aditec-portal | grep '\[auth\]'       # ingresos
```
Rotación automática: 3 archivos de 10 MB.

### Respaldar
`data/` se puede regenerar desde MBA3, pero respaldarlo evita ~220 peticiones de recarga.
`config/` y `.env` **no** se pueden regenerar.
```bash
tar czf ~/respaldo-aditec-portal-$(date +%F).tgz data config .env
chmod 600 ~/respaldo-aditec-portal-*.tgz      # contiene credenciales y hashes
```
Restaurar: detener el contenedor, extraer el `.tgz` en la carpeta del proyecto y `docker compose up -d`.

### Diagnóstico (consumen peticiones a MBA3, úsalos con moderación)
| Script | Peticiones |
|---|---|
| `scripts/probar-conexion.js` | 2 |
| `scripts/explorar.js <TABLA> --where=... --limit=N` | 2 (máx. 50 filas) |
| `scripts/verificar-vendedor.js <VENDEDOR> <AAAA-MM>` | 3 (compara tablero vs MBA3) |
| `scripts/analizar-mes.js <AAAA-MM>` | 0 (requiere `sync-manual --mes=... --crudo`) |

### Desarrollo
```bash
docker run --rm -v "$PWD":/app:Z -w /app node:20-alpine node --test test/     # tests
docker run --rm -it -p 127.0.0.1:8091:8091 -v "$PWD":/app:ro,Z -w /app node:20-alpine node scripts/dev.js
# -> http://localhost:8091 (usuario dev / desarrollo-123), datos sintéticos y simulador de MBA3
```

### Configuración (`.env`, ver `.env.example`)
`MBA3_*` (credenciales y pausa), `SESSION_SECRET`, `SESSION_HORAS`, `COOKIE_SECURE`,
`SYNC_ACTIVO`, `SYNC_MES_ACTUAL_MIN`, `SYNC_HISTORIA_DESDE`, `TRUST_PROXY`, `TRUSTED_PROXY_IPS`.

---

## Supuestos pendientes con Contabilidad

| # | Supuesto | Impacto | Estado |
|---|---|---|---|
| 1 | **TOTAL_DEVOLUCION sin IVA**: se resta tal cual de las ventas. Cuadra al centavo con TOT_RETURN_AMOUNT de movimientos (oct-2026: 10.451,95), que es valor de línea sin impuesto. | DD y VN | Confirmar |
| 2 | **Notas de crédito fuera de factura**: solo se toman devoluciones registradas en la propia factura (`TOTAL_DEVOLUCION`) y fechadas en la fecha de la factura. Una NC emitida en otro mes, o no ligada a factura, no se refleja. | VN del mes | Confirmar |
| 3 | **Descuento = valor de factura**: 42 facturas de oct-2026 (MA-DG, MA-DO y devoluciones totales) traen VALOR_TOTAL_DESCUENTO igual al VALOR_FACTURA con IVA. Hoy cuentan como descuento (sube VB y %D; VN no cambia). Regla en `config/reglas.json`. | VB, %D | Decidir |
| 4 | **Asignación de gastos**: MBA3 no trae asesor en gastos/nómina. Propuesta: 6111 = nómina, 6112 = generales (sin 61120200/61120201); gasto comercial (centro 01) por departamento y resto prorrateado por ventas netas. Mientras `gastos.json` no esté confirmado, UN/RUN/R se muestran "Pendiente de configurar". | GN, GG, UN, RUN | Decidir |
| 5 | **Departamentos**: 1 ≈ PRI (matriz), 2 ≈ UIO (Quito), 3 = ? | Asignación de gastos | Confirmar |
| 6 | **Mes anterior**: los meses cerrados quedan fijos tras la descarga; octubre cambió después de cerrado (+23,37 en descuentos). Recargar a mano o refrescar automáticamente hasta el día 10. | Exactitud | Decidir |
| 7 | **Sucursal de cada asesor** (`vendedores.json`): mientras falte, se usa el ORIGEN predominante (PRI/UIO). | Filtros y dona | Completar |

---

## Seguridad
- Contraseñas con scrypt; cookie `aditec_sid` HttpOnly + SameSite=Strict firmada (HMAC-SHA256), 8 h.
- 5 intentos fallidos por IP en 15 min → bloqueo 15 min.
- CSP sin scripts ni estilos inline, X-Frame-Options DENY, nosniff, no-referrer.
- Contenedor no root, sistema de archivos de solo lectura, sin capacidades, 512 MB.
- Secretos solo en `.env` (600, fuera de git). Los logs no registran contraseñas, cookies ni JWT.
- Puerto 8090 abierto solo a 192.168.1.0/24 (`ops/firewall-8090.sh`). HTTPS vía proxy: `ops/proxy-ejemplo.md`.
