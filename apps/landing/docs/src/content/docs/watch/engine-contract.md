---
title: 'Contract with the engine'
description: 'Which karajan-rag API watch consumes and which gaps were proposed upstream: watch orchestrates, it never reimplements RAG mechanics.'
---

<!-- translated-from: manufosela/karajan-watch@v0.3.0:docs/karajan-rag-contract.md · source-sha256: d0d6ef99577b6df70e456e92973c2184f23c1dfc75063b1777d9063578e16995
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

Which karajan-rag 1.2.x API karajan-watch consumes, and which gaps have
been proposed upstream. Family rule: **generic RAG lives in the engine**
— watch orchestrates, it never reimplements RAG mechanics.

## Consumed API

| Piece | Use in watch | Where |
| ----- | ------------ | ----- |
| CLI `karajan-rag index <path> --store --embedder` | Incremental reindex of the multi-repo workspace on every merge | `src/ingest.js`, `ingest.yml` workflow |
| `karajan.config.json` (`easy` section: `store`, `embedder`, `sensitivity`, `sensitivityRules`) | Watch generates it at the workspace root to stamp the sensitivity declared by the deployment layer (corpus level + one rule per `repo/` prefix) | `buildIngestPlan` |
| `SENSITIVITY_LEVELS`, `DEFAULT_SENSITIVITY` | Deployment-config validation: `public \| internal \| confidential`, safe default `internal` | `src/config.js` |
| Incremental manifest (`.karajan/` of the indexed rootDir) | Only what changed is reprocessed; missing files are invalidated (hence the full-workspace verification) | `verifyWorkspace` |
| `queryIndex` (ESM export) | F2: every chunk of the merged diff as a query against the `code` corpus; hits expose `source` (namespaced `repo/…` path) | impact pipeline (F2) |
| `karajan-rag serve [--mcp \| --http] --store` | Serving each corpus to agents (MCP stdio or HTTP) | deployment |
| Sensitivity policy (allowed adapters per level) | F2/F3: the LLM judgment only runs through adapters the policy allows for the corpus's effective level | impact pipeline (F2) |
| Stores `lancedb \| pgvector \| in-memory`, embedders `hash \| transformers` | Valid values of the configuration schema | `src/config.js` |

## Upstream gaps (proposed in the Karajan RAG Planning Game)

1. **Multi-corpus serve in one process** (KJR-PRP-0001). `serve` ties a
   process to one `rootDir` + store; `--http` and `--mcp` are mutually
   exclusive. Watch needs to serve `code` and `docs` at once.
   *Current workaround:* one service per corpus.
2. **Per-prefix/repo query filter** (KJR-PRP-0002). `queryIndex` accepts
   no origin filter; cross-repo impact must exclude the diff's origin
   repo. *Current workaround:* post-hoc filtering on `hit.source` (pays
   retrieval for discarded hits and bites into the top-k).
3. **Configurable pgvector table per corpus** (KJR-PRP-0003). The CLI
   fixes `karajan_rag_chunks`; `code` and `docs` cannot share a
   database. *Current workaround:* one `PG_URL` (database or schema) per
   corpus.

If a gap closes upstream, the corresponding workaround is removed from
watch in the same version that adopts the new engine.
