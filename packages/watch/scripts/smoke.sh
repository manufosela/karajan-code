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
# Se ejecuta contra los dos stores desplegables, con el mismo guión: lo que
# vale para uno tiene que valer para el otro, o la diferencia es un bug.
#
# Uso:  scripts/smoke.sh                                  (lancedb, sin servidor)
#       STORE=pgvector PG_URL=postgres://... scripts/smoke.sh
set -euo pipefail

STORE="${STORE:-lancedb}"
case "$STORE" in
  lancedb | pgvector) ;;
  *) printf 'STORE debe ser lancedb o pgvector (recibido: %s)\n' "$STORE" >&2; exit 1 ;;
esac
if [ "$STORE" = pgvector ]; then
  : "${PG_URL:?falta PG_URL (postgres con la extensión vector)}"
fi
EMBEDDER_DIMS=256   # dimensión del embedder `hash` en karajan-rag
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

say "empaquetar e instalar el tarball como lo haría una organización ($STORE)"
cd "$REPO_ROOT"
TARBALL="$(npm pack --silent | tail -1)"
mv "$TARBALL" "$WORK/"
cd "$WORK"
npm init -y >/dev/null
# El backend del store es un peer: karajan-rag no declara dependencias, así
# que lo instala quien despliega. Que el producto lo ANUNCIE es parte de lo
# que valida este smoke; aquí se instala como lo haría el usuario avisado.
if [ "$STORE" = pgvector ]; then STORE_PEER=pg; else STORE_PEER=@lancedb/lancedb; fi
npm install --silent "./$TARBALL" "$STORE_PEER" >/dev/null

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

if [ "$STORE" = pgvector ]; then
  say "base vacía: el esquema lo crea el PRODUCTO, no este script"
  # El smoke ya no se sabe el SQL. Se tira la tabla a propósito para que la
  # ingesta tenga que crearla: lo que se valida es que karajan-watch prepara
  # el store con la dimensión del embedder, que es justo donde se estrellaba
  # quien seguía la migración del motor (768 contra 256 reales).
  sql "DROP TABLE IF EXISTS karajan_rag_chunks;" >/dev/null
fi

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
# Documentación en el MISMO repo que cambia: el caso más común de deriva.
cat > .kjw-workspace/repo-api/README.md <<'MD'
# repo-api

## Endpoints

- `GET /api/v1/users/:id` — devuelve el perfil de un usuario.
- `POST /api/v1/orders` — crea un pedido.
MD
mkdir -p .kjw-workspace/repo-client/docs
cat > .kjw-workspace/repo-client/docs/manual.md <<'MD'
# Manual de integración

Para consultar un usuario, llama a `GET /api/v1/users/:id` con el token de
sesión. Devuelve el perfil completo.
MD
for repo in repo-api repo-client; do
  git -C ".kjw-workspace/$repo" init -q
  git -C ".kjw-workspace/$repo" -c user.email=smoke@example.com -c user.name=smoke \
    add -A
  git -C ".kjw-workspace/$repo" -c user.email=smoke@example.com -c user.name=smoke \
    commit -qm "estado inicial"
done

if [ "$STORE" = lancedb ]; then
  # La vía por defecto se ejercita con el config MÍNIMO de verdad: solo
  # repos. Si algún día deja de bastar, este smoke se entera (KJW-TSK-0032).
  say "config mínimo: solo repos, todo lo demás por defecto"
  cat > karajan-watch.config.json <<'JSON'
{
  "repos": [
    { "name": "repo-api", "sensitivity": "public" },
    { "name": "repo-client", "sensitivity": "public" }
  ],
  "history": { "enabled": true }
}
JSON
else
  cat > karajan-watch.config.json <<JSON
{
  "repos": [
    { "name": "repo-api", "sensitivity": "public" },
    { "name": "repo-client", "sensitivity": "public" }
  ],
  "corpus": {
    "code": { "store": "$STORE", "embedder": "hash", "sensitivity": "public" },
    "docs": { "store": "$STORE", "embedder": "hash", "sensitivity": "public" }
  },
  "impact": { "thresholds": { "minSimilarity": 0, "maxCandidates": 20 } }
}
JSON
fi

say "ingest real"
./node_modules/.bin/karajan-watch ingest \
  --config karajan-watch.config.json --workspace .kjw-workspace --corpus code

# El corpus tiene que sobrevivir al proceso: `impact` corre después, en otro
# proceso, y si no lo encuentra el informe saldrá vacío.
if [ "$STORE" = pgvector ]; then
  DECLARED="$(sql "SELECT format_type(a.atttypid, a.atttypmod) AS t
                   FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                   WHERE c.relname = 'karajan_rag_chunks' AND a.attname = 'embedding'")"
  [ "$DECLARED" = "vector($EMBEDDER_DIMS)" ] \
    || fail "el producto creó la columna como '$DECLARED' y el embedder da $EMBEDDER_DIMS"
  echo "esquema creado por el producto: embedding $DECLARED"

  CHUNKS="$(sql 'SELECT count(*)::int AS n FROM karajan_rag_chunks')"
  [ "$CHUNKS" -gt 0 ] || fail "el corpus quedó vacío tras la ingesta"
  echo "chunks indexados: $CHUNKS"
else
  CORPUS_DIR="$(find . -type d -name '*.lance' -not -path './node_modules/*' | head -1)"
  [ -n "$CORPUS_DIR" ] || fail "lancedb no dejó ningún corpus en disco tras la ingesta"
  echo "corpus en disco: $CORPUS_DIR"
fi

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

say "drift real: qué documentación queda mintiendo tras el mismo merge"
# Un solo índice para código y docs, que es lo que tiene quien empieza: el
# corpus `docs` comparte store, y la deriva se queda con los ficheros de
# documentación. El manual cita el endpoint que el diff acaba de eliminar.
./node_modules/.bin/karajan-watch drift \
  --config karajan-watch.config.json --workspace .kjw-workspace \
  --repo repo-api --diff merge.diff --no-deliver | tee deriva.md

grep -q 'repo-client/docs/manual.md' deriva.md \
  || fail "el manual que documenta el endpoint eliminado no aparece en la deriva"
grep -q 'repo-api/README.md' deriva.md \
  || fail "el README del PROPIO repo que cambió no aparece en la deriva"
grep -q 'repo-api/src/routes.js' deriva.md \
  && fail "la deriva listó el fichero que el diff acaba de tocar"
grep -q '/api/v1/users/:id' deriva.md \
  || fail "la deriva no cita el identificador que quedó obsoleto"
grep -qi 'eliminado' deriva.md \
  || fail "la deriva no marca el identificador como eliminado"
grep -q 'repo-client/src/api-client.js' deriva.md \
  && fail "la deriva listó código: eso es cosa del pipeline de impacto"

say "eval real: el cuarto comando, el único que nunca se había ejecutado"
# El golden se construye con el MISMO diff del merge, esperando al consumidor
# que ya sabemos que existe. Se comprueba el informe, no el exit code.
node -e '
  const fs = require("node:fs");
  fs.writeFileSync("golden.json", JSON.stringify({
    thresholds: { precision: 0.1, recall: 1, k: 10 },
    cases: [{
      name: "endpoint renombrado",
      repoName: "repo-api",
      diff: fs.readFileSync("merge.diff", "utf8"),
      expectedImpacted: ["repo-client/src/api-client.js"],
    }],
  }, null, 2));
'
./node_modules/.bin/karajan-watch eval \
  --config karajan-watch.config.json --workspace .kjw-workspace \
  --golden golden.json | tee eval.md

grep -q 'PASSED' eval.md \
  || fail "el eval no alcanzó los umbrales: el consumidor del endpoint debería estar en el ranking"
grep -q "medido con: store $STORE" eval.md \
  || fail "el informe no dice con qué store se midió, y los scores no son comparables entre backends"

if [ "$STORE" = lancedb ]; then
  say "historial: los informes quedan guardados, no solo impresos"
  HIST=.kjw-workspace/.kjw-history/reports.ndjson
  [ -s "$HIST" ] || fail "el historial está activado en el config y no se escribió nada"

  # Un run de impact y otro de drift, cada uno en su línea.
  LINEAS="$(wc -l < "$HIST")"
  [ "$LINEAS" -ge 2 ] || fail "esperaba al menos impact y drift en el historial, hay $LINEAS línea(s)"
  node -e '
    const fs = require("node:fs");
    const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    const kinds = rows.map((r) => r.kind);
    if (!kinds.includes("impact") || !kinds.includes("drift")) {
      console.error("faltan tipos en el historial: " + kinds.join(", "));
      process.exit(1);
    }
    const impact = rows.find((r) => r.kind === "impact");
    if (!impact.at || !impact.measuredWith?.store) {
      console.error("un registro sin fecha o sin saber con qué se midió no sirve de histórico");
      process.exit(1);
    }
    const citado = JSON.stringify(impact.entries).includes("/api/v1/users/:id");
    if (!citado) {
      console.error("el histórico no conserva la evidencia citada");
      process.exit(1);
    }
    console.log(`historial: ${rows.length} informes, evidencia conservada, medido con ${impact.measuredWith.store}`);
  ' "$HIST"
fi

printf '\n\033[32m✓ smoke OK: ingest, impact, drift y eval funcionan con store %s\033[0m\n' "$STORE"
