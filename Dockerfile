# Portal ADITEC — imagen de producción.
# Sin dependencias npm (solo módulos nativos de Node): no hay `npm install`.
FROM node:20-alpine

ENV NODE_ENV=production \
    TZ=America/Guayaquil \
    DATA_DIR=/app/data \
    CONFIG_DIR=/app/config \
    PUBLIC_DIR=/app/public/ \
    NODE_OPTIONS=--max-old-space-size=384

WORKDIR /app
COPY --chown=root:root package.json ./
COPY --chown=root:root src ./src
COPY --chown=root:root public ./public
COPY --chown=root:root scripts ./scripts

# Usuario sin privilegios (uid 1000 = node; coincide con 'aditec' en el host para ./data).
# El código queda como root:root, de solo lectura para el proceso.
USER node
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
