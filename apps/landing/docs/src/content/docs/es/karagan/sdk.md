---
title: 'SDK embebible'
description: 'createRag() en Astro, Next o Fastify: el mismo RagService del CLI, con los tres modos y el camino guardado.'
---

<!-- synced-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · section-sha256: 78dbdaabe6cff1b03f585a5495c995acebbec0758b477ab626654a02beee2e80
     NO EDITAR A MANO — regenerado con `npm run sync:family-docs` -->

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
