FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ src/
COPY public/ public/
ENV PORT=4000
ENV KJ_HOME=/data
EXPOSE 4000

# Drop root: hu-board can be bound to 0.0.0.0 via --bind, so any CVE in
# express/helmet/rate-limit would otherwise execute as UID 0 inside the
# container. The `node` user already ships with the node:22-alpine base.
# Audited via semgrep dockerfile.security.missing-user (KJC-BUG-0071).
RUN mkdir -p /data && chown -R node:node /app /data
USER node

CMD ["node", "src/server.js"]
