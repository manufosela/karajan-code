# kaRAGan — RAG over this directory (agent instructions)

Goal: the directory the user names (their code, docs or data — one repo or a
workspace of several) becomes a queryable RAG. Requires karajan-rag on the
machine ([install-machine.md](https://rag.karajancode.com/install-machine.md)
if not). The HARD RULE from
[start.md](https://rag.karajancode.com/start.md) applies.

## 1. Sensitivity first — ask, never guess

Before touching anything, ask the user ONE question and wait for the answer:

> How sensitive is this content? **public** (can reach any AI provider),
> **internal** (local + private clouds only), or **confidential** (never
> leaves this machine — answers only via a local model)?

This is a data-protection decision that belongs to the human. If they are
unsure, recommend `internal` (the safe default) and explain the difference.
Also ask if some subdirectories deserve a different level (e.g. a public
`docs/` inside an internal codebase) — those become `sensitivityRules`
entries by path prefix.

If the answer is `confidential` and there is no local model (Ollama) on the
machine, warn NOW: retrieval will work, but `--answer` will refuse every
provider — by design. Offer the install route (STOP-AND-WAIT applies).

## 2. Configure and index

```sh
karajan-rag init . --yes     # karajan.config.json with safe defaults + .karajan/ gitignored
karajan-rag index .          # chunk + embed + persist; incremental on every re-run
```

After `init`, set the agreed sensitivity in `karajan.config.json` — for
example:

```json
{
  "easy": {
    "store": "lancedb",
    "embedder": "hash",
    "sensitivity": "internal",
    "sensitivityRules": [{ "prefix": "docs/public/", "level": "public" }]
  }
}
```

Notes that matter:

- **Multi-repo**: clone the repos side by side under one parent directory
  and run `init`/`index` on the parent — paths stay namespaced per repo and
  `sensitivityRules` can assign per-repo levels.
- **Embedder**: `hash` (default) is deterministic and dependency-free —
  fine to try the flow. For real semantic quality suggest
  `"embedder": "transformers"` (needs `@huggingface/transformers`; changing
  embedder triggers a full reindex by fingerprint, that is correct
  behavior).
- Changing `sensitivity` later and re-running `index` restamps every file —
  the gate never trusts stale marks.

## 3. Verify with a real query

```sh
karajan-rag query "something the user would actually ask" .
```

Expect `file:line (score)` hits with passages. If it returns nothing
useful, do not shrug — check `karajan-rag doctor`, the indexed file count,
and whether the corpus needs the `transformers` embedder.

## 4. Serve it (what the user usually wants)

- **MCP for agents** (Claude Code and friends):
  `claude mcp add my-rag -- karajan-rag serve /abs/path/to/corpus` — tools
  `rag_query` / `rag_status` appear in every session.
- **HTTP API**: `karajan-rag serve . --http --port 8080` →
  `POST /query`, `GET /health`.

## 5. Answers with an LLM (optional)

`karajan-rag query "..." . --answer` routes through the sensitivity policy:
the effective level is the MAXIMUM of the retrieved chunks, a forbidden
`--adapter` fails with the allowed list (that error is a feature, not a
bug — explain it to the user), and PII is redacted before anything leaves.
`confidential` → answers come from Ollama locally or not at all.

## 6. Hand over

Run `karajan-rag doctor`. Report: what was indexed (files/chunks), the
sensitivity contract in force, how to keep the index fresh (re-run
`karajan-rag index .` after pulling changes — incremental), and two or
three example queries tailored to THEIR corpus.
