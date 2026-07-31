#!/usr/bin/env bash
# Smoke end-to-end contra infraestructura real.
#
# Existe porque los tests con dobles no vieron que la ingesta estaba rota y
# se publicó así (KJW-BUG-0003). Aquí se instala el TARBALL en un directorio
# limpio —como haría una organización— y se ejecuta el producto de verdad
# contra un pgvector real, comprobando el INFORME, no el exit code.
#
# Deliberadamente sin LLM (--no-judge) y con el embedder `hash`: lo que se
# valida es la fontanería, no la calidad semántica. Así el job es rápido,
# determinista y no depende de la red ni de cuotas.
#
# Uso:  PG_URL=postgres://... scripts/smoke.sh
set -euo pipefail

: "${PG_URL:?falta PG_URL (postgres con la extensión vector)}"
EMBEDDER_DIMS=256   # dimensión del embedder `hash` en karajan-rag
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

say "empaquetar e instalar el tarball como lo haría una organización"
cd "$REPO_ROOT"
TARBALL="$(npm pack --silent | tail -1)"
mv "$TARBALL" "$WORK/"
cd "$WORK"
npm init -y >/dev/null
npm install --silent "./$TARBALL" pg >/dev/null

# El esquema y las consultas van por el cliente `pg` ya instalado: así el
# smoke no depende de tener psql en la máquina (ni local ni en el runner).
sql() {
  PG_URL="$PG_URL" SQL_TEXT="$1" node -e '
    const { Client } = require("pg");
    const c = new Client({ connectionString: process.env.PG_URL });
    c.connect()
      .then(() => c.query(process.env.SQL_TEXT))
      .then((r) => { if (r.rows?.[0]) console.log(Object.values(r.rows[0])[0]); })
      .then(() => c.end())
      .catch((e) => { console.error(e.message); process.exit(1); });
  '
}

say "esquema pgvector (dim $EMBEDDER_DIMS)"
# Mientras el motor no cree su esquema (KJR-PRP-0008) lo prepara el smoke.
# La dimensión DEBE coincidir con la del embedder o el INSERT revienta.
sql "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null
sql "DROP TABLE IF EXISTS karajan_rag_chunks;" >/dev/null
sql "CREATE TABLE karajan_rag_chunks (
       id text PRIMARY KEY, source text, chunk_index integer, content text,
       embedding vector($EMBEDDER_DIMS), metadata jsonb DEFAULT '{}'::jsonb,
       created_at timestamptz NOT NULL DEFAULT now());" >/dev/null
sql "CREATE INDEX ON karajan_rag_chunks (source);" >/dev/null

say "workspace multi-repo: un proveedor y un consumidor de su endpoint"
mkdir -p .kjw-workspace/repo-api/src .kjw-workspace/repo-client/src
cat > .kjw-workspace/repo-api/src/routes.js <<'JS'
export const mount = (app) => {
  app.get('/api/v1/users/:id', getUser);
  app.post('/api/v1/orders', createOrder);
};
JS
cat > .kjw-workspace/repo-client/src/api-client.js <<'JS'
// Consume el endpoint del proveedor: la señal de contratos debe verlo.
export const fetchUser = (id) =>
  fetch('/api/v1/users/:id'.replace(':id', id)).then((r) => r.json());
JS
for repo in repo-api repo-client; do
  git -C ".kjw-workspace/$repo" init -q
  git -C ".kjw-workspace/$repo" -c user.email=smoke@example.com -c user.name=smoke \
    add -A
  git -C ".kjw-workspace/$repo" -c user.email=smoke@example.com -c user.name=smoke \
    commit -qm "estado inicial"
done

cat > karajan-watch.config.json <<'JSON'
{
  "repos": [
    { "name": "repo-api", "sensitivity": "public" },
    { "name": "repo-client", "sensitivity": "public" }
  ],
  "corpus": {
    "code": { "store": "pgvector", "embedder": "hash", "sensitivity": "public" },
    "docs": { "store": "pgvector", "embedder": "hash", "sensitivity": "public" }
  },
  "impact": { "thresholds": { "minSimilarity": 0, "maxCandidates": 20 } }
}
JSON

say "ingest real"
./node_modules/.bin/karajan-watch ingest \
  --config karajan-watch.config.json --workspace .kjw-workspace --corpus code

CHUNKS="$(sql 'SELECT count(*)::int AS n FROM karajan_rag_chunks')"
[ "$CHUNKS" -gt 0 ] || fail "el corpus quedó vacío tras la ingesta"
echo "chunks indexados: $CHUNKS"

say "impact real sobre un diff que renombra el endpoint"
cat > merge.diff <<'DIFF'
diff --git a/src/routes.js b/src/routes.js
index 1111111..2222222 100644
--- a/src/routes.js
+++ b/src/routes.js
@@ -1,4 +1,4 @@
 export const mount = (app) => {
-  app.get('/api/v1/users/:id', getUser);
+  app.get('/api/v2/users/:id', getUser);
   app.post('/api/v1/orders', createOrder);
 };
DIFF

./node_modules/.bin/karajan-watch impact \
  --config karajan-watch.config.json --workspace .kjw-workspace \
  --repo repo-api --diff merge.diff --no-judge --no-deliver | tee informe.md

say "comprobar el informe"
grep -q 'repo-client/src/api-client.js' informe.md \
  || fail "el consumidor del endpoint no aparece en el informe"
grep -q '/api/v1/users/:id' informe.md \
  || fail "la señal de contratos no citó el endpoint eliminado"
grep -qi 'contrato' informe.md \
  || fail "el informe no marca la coincidencia como contrato"

printf '\n\033[32m✓ smoke OK: ingest e impact funcionan contra pgvector real\033[0m\n'
