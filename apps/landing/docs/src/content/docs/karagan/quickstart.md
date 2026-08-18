---
title: 'RAG in 5 minutes'
description: 'Index and query a codebase, documents or data without writing a single line of code. Offline and credential-free.'
---

<!-- translated-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · source-sha256: 3d7d490d5a1f787df0f83628b68c4488c9f11a617902fca4b2a94d592c2abf3a
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

End-to-end guide to the Easy RAG layer ([ADR-005](https://github.com/manufosela/karajan-rag/blob/v1.5.0/docs/adrs/ADR-005-easy-rag-layer.md)):
build a queryable RAG over a codebase, documents or data without writing
a single line of code. Everything works offline and without credentials.

## Requirements

```bash
npm install -g karajan-rag      # or npx karajan-rag <command>
pnpm add @lancedb/lancedb       # default local store (optional peer)
```

## 1. Index

```bash
karajan-rag index ./my-project
```

What happens:

- Autodetection by file type: **code** (js/ts/py/go/…) is chunked
  respecting declaration boundaries, **docs** (md/txt/rst) by headings,
  **data** (csv/tsv/jsonl) in record batches with the header as context.
  Binaries and unknown extensions are excluded and listed — never
  silently ignored.
- The index persists in `./my-project/.karajan/` (gitignore it — `init`
  does that for you) with a `manifest.json` that stores the vector-space
  fingerprint (ADR-002) and the hash of every file.
- **Incremental reindexing**: run the same command again and only what
  changed is reprocessed; deleted files are invalidated from the store.

> The default embedder is `hash`: deterministic and dependency-free,
> ideal to try the flow. For real semantic quality use
> `--embedder transformers` (requires `@huggingface/transformers`).

## 2. Query

```bash
karajan-rag query "how is billing calculated?" ./my-project
```

Hybrid retrieval (vector + BM25 with dedupe) with `file:line (score)`
output plus the passage. The embedder self-configures from the manifest:
querying with a vector space different from the indexed one is
impossible.

With an AI CLI installed (claude/codex/gemini/ollama…), add generation:

```bash
karajan-rag query "how is billing calculated?" ./my-project --answer --adapter ollama
```
