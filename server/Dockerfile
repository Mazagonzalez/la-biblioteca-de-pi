# Servidor de La Biblioteca de π. Sin dependencias: Node 24 ejecuta TypeScript
# directamente (quitando los tipos), así que no hay paso de compilación.
FROM node:24-slim

WORKDIR /app
COPY server/ ./server/
COPY src/lib/spigot.ts ./src/lib/spigot.ts

ENV NODE_ENV=production \
    DATA_DIR=/data \
    CPU_DUTY=0.1

EXPOSE 8787
CMD ["node", "server/main.ts"]
