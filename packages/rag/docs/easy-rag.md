# RAG en 5 minutos (Easy RAG)

Guía end-to-end de la capa Easy RAG ([ADR-005](./adrs/ADR-005-easy-rag-layer.md)):
crear un RAG consultable sobre una base de código, documentos o datos sin
escribir una línea de código. Todo funciona offline y sin credenciales.

## Requisitos

```bash
npm install -g karajan-rag      # o npx karajan-rag <comando>
pnpm add @lancedb/lancedb       # store local por defecto (peer opcional)
```

## 1. Indexar

```bash
karajan-rag index ./mi-proyecto
```

Qué pasa:

- Autodetección por tipo de fichero: **código** (js/ts/py/go/…) se trocea
  respetando límites de declaración, **docs** (md/txt/rst) por headings,
  **datos** (csv/tsv/jsonl) por lotes de registros con la cabecera como
  contexto. Binarios y extensiones desconocidas quedan excluidos y
  listados — nunca ignorados en silencio.
- El índice persiste en `./mi-proyecto/.karajan/` (gitignóralo — `init` lo
  hace por ti) con un `manifest.json` que guarda el fingerprint del espacio
  vectorial (ADR-002) y el hash de cada fichero.
- **Reindexado incremental**: vuelve a lanzar el mismo comando y solo se
  reprocesa lo que cambió; los ficheros borrados se invalidan del store.

> El embedder por defecto es `hash`: determinista y sin dependencias, ideal
> para probar el flujo. Para calidad semántica real usa
> `--embedder transformers` (requiere `@huggingface/transformers`).

## 2. Consultar

```bash
karajan-rag query "¿cómo se calcula la facturación?" ./mi-proyecto
```

Retrieval híbrido (vector + BM25 con dedupe) con salida `fichero:línea (score)`
y el pasaje. El embedder se autoconfigura desde el manifest: es imposible
consultar con un espacio vectorial distinto al indexado.

Con un CLI de IA instalado (claude/codex/gemini/ollama…), añade generación:

```bash
karajan-rag query "¿cómo se calcula la facturación?" ./mi-proyecto --answer --adapter ollama
```

### Un motor, tres estrategias de contexto

La decisión central de cualquier RAG es **qué contexto viaja al modelo**.
karajan-rag no la impone: sobre el mismo índice ofrece tres estrategias
(`--mode rag|cag|hybrid`), todas por el mismo camino guardado (sensitivity
policy + redacción PII). `rag` es el default que ya has visto: los top-k
chunks del retrieval híbrido.

#### Modo CAG: el corpus completo como contexto

Para corpus pequeños/medianos, `--mode cag` (Cache-Augmented Generation)
salta el retrieval y carga **todo el corpus** en el contexto del modelo:

```bash
karajan-rag query "resume la arquitectura" ./mi-proyecto --answer --mode cag
```

- El contexto es **determinista y estable** (orden por ruta): mismo
  corpus → mismo prompt, lo que permite al proveedor amortizar su
  prompt-cache entre consultas.
- La sensibilidad efectiva es el **máximo de todo el manifest** — aquí
  viaja el corpus entero, así que el gate es más restrictivo que en RAG
  por diseño. La redacción PII aplica igual.
- Presupuesto con fallo explícito (`--max-context-chars`, default
  400K caracteres ≈ 100K tokens): si el corpus no cabe, error con el
  tamaño real y alternativas — **nunca se trunca en silencio**.
- No necesita vector store para responder (el manifest basta), pero sí
  un corpus indexado.

Y el término medio, `--mode hybrid`: el retrieval **selecciona** los
ficheros relevantes y el contexto lleva esos ficheros **completos** (no
fragmentos), con los que no caben en el presupuesto declarados en el
log. Ideal cuando los chunks se quedan cortos pero el corpus entero no
cabe.

Regla rápida: corpus que cabe en contexto y preguntas que piden visión
global → `cag`; corpus grande y preguntas puntuales → `rag`; corpus
grande y preguntas que piden entender ficheros enteros → `hybrid`.
¿Dudas con TU corpus? Decide con datos:

```bash
karajan-rag eval golden.json --compare-modes
```

Compara offline el recall del retrieval contra el coste de contexto de
cada modo y emite una recomendación justificada con números.

## 3. Servir

### Como servidor MCP (para Claude Code y otros agentes)

```bash
claude mcp add mi-rag -- karajan-rag serve /ruta/a/mi-proyecto
```

Expone las tools `rag_query` y `rag_status` por stdio (JSON-RPC 2.0).

### Como HTTP API

```bash
karajan-rag serve ./mi-proyecto --http --port 8080
curl -s localhost:8080/health
curl -s -X POST localhost:8080/query -H 'content-type: application/json' \
  -d '{"question": "facturación", "topK": 3}'
```

## 4. Personalizar (opcional)

```bash
karajan-rag init ./mi-proyecto        # wizard → karajan.config.json
karajan-rag init ./mi-proyecto --yes  # no interactivo (CI)
```

La config actúa como defaults del proyecto (store, embedder, dimensions,
topK, adapter, sensitivity); los flags de CLI siempre ganan. Config
inválida → error explícito con la clave exacta.

## 5. Sensibilidad y privacidad

Desde 0.7.0 la capa easy aplica la [sensitivity policy](./security/sensitivity-audit.md)
de punta a punta (ADR-005 §6). Declara el nivel de tu corpus en
`karajan.config.json`:

```json
{
  "easy": {
    "sensitivity": "internal",
    "sensitivityRules": [
      { "prefix": "docs/public/", "level": "public" },
      { "prefix": "finanzas/", "level": "confidential" }
    ]
  }
}
```

- **Niveles**: `public` | `internal` | `confidential`. Sin declarar nada,
  todo cuenta como `internal` (default seguro: nunca se asume público).
  Las reglas por prefijo son excepciones; gana la primera que matchea.
- **Al indexar**, cada documento queda marcado con su nivel y los chunks
  lo heredan en el store.
- **En `query --answer`**, el nivel efectivo es el **máximo** de los
  chunks recuperados: un solo chunk `confidential` en el contexto hace
  confidential a toda la respuesta. La policy por defecto permite:
  `confidential → ollama` (local), `internal → ollama y nubes privadas`,
  `public → cualquier proveedor`.
  - `--adapter` explícito no permitido para el nivel → **error** con la
    lista de permitidos (nunca se degrada en silencio lo que pediste).
  - Adapter de config/default no permitido → se enruta al primer
    proveedor permitido, avisando por stderr.
- **En `eval --judges`**, declara el nivel con `--sensitivity` (default
  `internal`); los jueces no permitidos se rechazan antes de enviar nada.
- **Defensa en profundidad**: todo lo que sale hacia un LLM va además por
  `redactPII` (emails, teléfonos, NIF/NIE, tarjetas, IBAN).
- Índices creados antes de 0.7.0 no tienen marca: sus chunks cuentan como
  `internal`. Reindexa para aplicar tus reglas.

## 6. En contenedor

```bash
docker build -t karajan-rag-server .
docker run --rm -v $PWD/mi-proyecto:/data --entrypoint node \
  karajan-rag-server bin/karajan-rag.js index /data
docker run -d -p 8080:8080 -v $PWD/mi-proyecto:/data karajan-rag-server
```

`docker compose up` levanta además Postgres+pgvector para el modo
`KARAJAN_STORE=pgvector` (ver `docker-compose.yml`).

## 7. En Google Cloud

```bash
cd deploy/gcp
terraform apply -var project_id=MI_PROYECTO
```

Cloud Run + Cloud SQL pgvector + GCS + Secret Manager, privado por defecto.
Flujo completo (imagen, migración, indexado, rsync del índice, query con
identity token) en [`deploy/gcp/README.md`](../deploy/gcp/README.md). El
despliegue está validado contra GCP real: [caso de uso documentado](./case-study-gcp.md).

## SDK embebible (frameworks, sin CLI)

`createRag()` expone la misma maquinaria desde código — para Astro, Next,
Fastify o cualquier worker Node:

```js
import { createRag } from 'karajan-rag';

const rag = await createRag({ rootDir: './docs' }); // defaults: lancedb + hash
await rag.index();                                   // incremental, como el CLI
const { hits } = await rag.query('¿cómo se factura?');

// Respuesta LLM con cualquiera de los tres modos — siempre por el camino
// guardado (sensitivity policy + redactPII), igual que el CLI:
const res = await rag.answer('resume la arquitectura', { mode: 'cag' });
console.log(res.answer, res.adapter, res.sensitivity, res.files);
// mode: 'rag' (top-k chunks) · 'cag' (corpus completo) · 'hybrid'
// (ficheros completos elegidos por el retrieval, con `excluded` declarado)
```

### Fastify — endpoint `/ask`

```js
import Fastify from 'fastify';
import { createRag } from 'karajan-rag';

const rag = await createRag({ rootDir: './docs' });
const app = Fastify();

app.post('/ask', async (request) => {
  const { question, topK } = request.body;
  return rag.query(question, { topK });
});

await app.listen({ port: 3000 });
```

### Astro / Next — endpoint API

```js
// src/pages/api/ask.js (Astro) — en Next: app/api/ask/route.js con POST(request)
import { createRag } from 'karajan-rag';

const rag = await createRag({ rootDir: './docs' });

export async function POST({ request }) {
  const { question } = await request.json();
  const result = await rag.query(question);
  return new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/json' },
  });
}
```

Para producción con store remoto, `createRag({ store: 'pgvector', env: process.env })`
consulta el mismo índice que sirve `karajan-rag serve` en Cloud Run — es el
mismo `RagService` por debajo. También acepta instancias inyectadas
(`store`/`embedder` propios) para tests o backends custom.

## Garantías transversales

- **Sensitivity first**: el routing por sensibilidad (§5) y el redactor
  PII están activos en toda salida hacia un LLM; easy-mode puede
  endurecerlos, nunca relajarlos.
- **Sin fallbacks silenciosos**: peer ausente, config inválida, índice
  inexistente o fingerprint incompatible → error con el paso exacto para
  arreglarlo.
- **Determinismo por defecto**: todo el flujo local funciona sin
  credenciales ni red.
