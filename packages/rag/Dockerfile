# syntax=docker/dockerfile:1
# Imagen del servidor Easy RAG (ADR-005 §7, KJR-TSK-0106).
#
# Sirve un índice montado en /data vía HTTP (POST /query, GET /health).
# Toda la configuración entra por entorno — nunca se hornean secretos:
#   PORT           puerto HTTP (default 8080)
#   KARAJAN_STORE  lancedb (default, índice local en /data/.karajan) | pgvector
#   PG_URL         cadena de conexión Postgres (solo con KARAJAN_STORE=pgvector)
#
# El índice se crea con el mismo binario, p. ej.:
#   docker run --rm -v $PWD:/data --entrypoint node <img> bin/karajan-rag.js index /data

FROM node:22-slim AS deps
WORKDIR /app
# karajan-rag no tiene dependencias runtime; se instalan solo los
# backends opcionales que la imagen ofrece: pg (pgvector) y LanceDB.
# Sobre un package.json vacío a propósito: el del repo lista pg en
# devDependencies y npm lo omitiría/mezclaría devDeps (KJR-BUG-0004).
RUN npm init -y > /dev/null \
  && npm install --no-package-lock pg @lancedb/lancedb \
  && npm cache clean --force

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    KARAJAN_STORE=lancedb
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json index.js ./
COPY bin ./bin
COPY src ./src
COPY migrations ./migrations
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/bin/sh", "-c", "exec node bin/karajan-rag.js serve /data --http --port ${PORT} --store ${KARAJAN_STORE}"]
