# api/

Handlers JSON (Fase 5). Todos leen SOLO de la caché en `data/`; ninguno llama a MBA3.
- `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET /api/resumen?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`
- `GET /api/estado-sync` (última sincronización, errores, si está detenido)
