FROM node:20-alpine

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    CONFIG_DIR=/app/config \
    PUBLIC_DIR=/app/public/

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Usuario sin privilegios (uid 1000 = node; coincide con 'aditec' en el host para ./data)
USER node
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
