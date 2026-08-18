---
title: 'Embeddable SDK'
description: 'createRag() in Astro, Next or Fastify: the same RagService as the CLI, with all three modes and the guarded path.'
---

<!-- translated-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · source-sha256: 78dbdaabe6cff1b03f585a5495c995acebbec0758b477ab626654a02beee2e80
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

`createRag()` exposes the same machinery from code — for Astro, Next,
Fastify or any Node worker:

```js
import { createRag } from 'karajan-rag';

const rag = await createRag({ rootDir: './docs' }); // defaults: lancedb + hash
await rag.index();                                   // incremental, like the CLI
const { hits } = await rag.query('how is billing calculated?');

// LLM answer with any of the three modes — always through the guarded
// path (sensitivity policy + redactPII), same as the CLI:
const res = await rag.answer('summarize the architecture', { mode: 'cag' });
console.log(res.answer, res.adapter, res.sensitivity, res.files);
// mode: 'rag' (top-k chunks) · 'cag' (whole corpus) · 'hybrid'
// (whole files picked by retrieval, with `excluded` declared)
```

## Fastify — an `/ask` endpoint

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

## Astro / Next — an API endpoint

```js
// src/pages/api/ask.js (Astro) — in Next: app/api/ask/route.js with POST(request)
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

For production with a remote store, `createRag({ store: 'pgvector', env: process.env })`
queries the same index that `karajan-rag serve` serves on Cloud Run — it
is the same `RagService` underneath. It also accepts injected instances
(your own `store`/`embedder`) for tests or custom backends.

## Cross-cutting guarantees

- **Sensitivity first**: sensitivity routing and the PII redactor are
  active on every output towards an LLM; easy mode can tighten them,
  never relax them.
- **No silent fallbacks**: missing peer, invalid config, missing index
  or incompatible fingerprint → an error with the exact step to fix it.
- **Deterministic by default**: the whole local flow works without
  credentials or network.
