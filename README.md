# Portal ADITEC (beta)

Tablero interno **"ADITEC ECUATORIANA – Rentabilidad por empleado / Resumen nacional"** con datos
del ERP MBA3 (solo lectura). La web lee únicamente de una caché local que llena un sincronizador
en segundo plano, respetando el límite de peticiones de MBA3.

## Requisitos
- Docker + docker compose, red externa `aditec-net` (`docker network create aditec-net`).
- Acceso de red a MBA3 (192.168.1.203:8081). Puerto 8090 abierto a la LAN.

## Puesta en marcha
```bash
cp .env.example .env && chmod 600 .env
# Editar .env: SESSION_SECRET (openssl rand -hex 32), MBA3_CODIGO, MBA3_PWD
docker compose up -d --build
curl http://localhost:8090/health
```

## Estructura
| Ruta | Contenido |
|---|---|
| `src/server.js` | Servidor http nativo, rutas, estáticos |
| `src/config.js` | Lee `.env` y `config/*.json`, valida al arrancar |
| `src/mba3/` | Cliente MBA3 (cola serial, JWT, parseo) y consultas |
| `src/sync/` | Sincronizador en segundo plano (único que habla con MBA3) |
| `src/calc/metrics.js` | Fórmulas de rentabilidad (puras, con tests) |
| `src/auth/`, `src/api/` | Usuarios/sesiones y handlers JSON |
| `public/` | Página, login, estilos, Chart.js local |
| `config/` | `vendedores.json`, `gastos.json`, `usuarios.json` (hash; no versionado) |
| `data/` | Caché (volumen; no versionado) |
| `scripts/` | Utilidades: crear usuario, probar conexión, explorar, sync manual |
| `test/` | Tests y simulador de MBA3 |

## Tests
```bash
docker run --rm -v "$PWD":/app:Z -w /app node:20-alpine node --test test/
```

## Reglas
Ver `CLAUDE.md`: solo lectura, una petición a la vez a MBA3 con 1500 ms de pausa, sin secretos
en logs ni en git.
