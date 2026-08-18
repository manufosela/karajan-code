---
title: 'Configuration'
description: 'karajan-watch.config.json: the contract between the generic product and each organization''s deployment repo, strictly validated.'
---

<!-- translated-from: manufosela/karajan-watch@v0.3.0:docs/config.md · source-sha256: 2b0d9931d6247e45ae30b97385bd1c0b20e52157b271b52414d069af19fb1c76
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

The contract between karajan-watch (generic, the product repo) and each
organization's deployment repo (private, theirs). EVERYTHING concrete
about an organization lives in this file, in its deployment repo — never
in the product.

Load it with `loadConfig(path)` / validate with `validateConfig(object)`
(exported from the package). Validation is strict: an unknown key or an
out-of-range value = `ConfigError` with the exact path
(`$.corpus.code.store`), no silent fallbacks. Full example in
[karajan-watch.config.example.json](https://github.com/manufosela/karajan-watch/blob/v0.3.0/karajan-watch.config.example.json).

## Schema

### `repos` (required)

Non-empty array. Each entry declares an observed repo:

| Key           | Type   | Required | Default    | Notes                                                |
| ------------- | ------ | -------- | ---------- | ---------------------------------------------------- |
| `name`        | string | yes      | —          | Unique; namespaces its paths in the corpus (`name/…`) |
| `branch`      | string | no       | `main`     | Branch whose merges trigger ingestion                |
| `sensitivity` | enum   | no       | `internal` | See [Sensitivity](#sensitivity)                      |

### `corpus` (required)

Exactly two entries: `code` and `docs` (separate tables/corpora).

| Key           | Type | Required | Default    | Values                               |
| ------------- | ---- | -------- | ---------- | ------------------------------------ |
| `store`       | enum | yes      | —          | `lancedb` \| `pgvector` \| `in-memory` |
| `embedder`    | enum | yes      | —          | `hash` \| `transformers` (local: the code never travels to a third-party embedder) |
| `sensitivity` | enum | no       | `internal` | See [Sensitivity](#sensitivity)      |

**You install the store backend yourself**: `@lancedb/lancedb` for
`lancedb`, `pg` for `pgvector`. The engine declares neither, so whoever
uses one does not pay for the other's binary; if it is missing, the
ingestion fails red naming which one.

With `lancedb` the corpus is a directory on disk: no server and nothing
to host, but **only whoever holds that disk can see it**. If `ingest`
and `impact` run on different machines — or on ephemeral runners that
keep nothing between jobs — the corpus must be persisted separately or
the store must be `pgvector`. The two `impact` thresholds are calibrated
against the store you use: scores are not comparable across backends.

### `impact` (optional)

Thresholds of the cross-repo impact pipeline (F2). If the section is
present, `thresholds` is required:

| Key                        | Type   | Constraint       |
| -------------------------- | ------ | ---------------- |
| `thresholds.minSimilarity` | number | in `[0, 1]`      |
| `thresholds.maxCandidates` | int    | `>= 1`           |

### `notify` (optional)

Notification targets. If the section is present, `targets` is a
non-empty array. Supported types:

- `{ "type": "pr-comment" }` — a comment on the merged PR.
- `{ "type": "webhook", "url": "https://…" }` — POST to the webhook (https only).

### `contracts` (optional)

Controls the contract signal (see [impact](../impact/)):

```json
{
  "contracts": { "enabled": true, "types": ["http", "event", "sql"] }
}
```

| Key       | Type    | Default   | Notes                                    |
| --------- | ------- | --------- | ---------------------------------------- |
| `enabled` | boolean | `true`    | `false` disables the signal entirely     |
| `types`   | array   | all three | subset of `http` \| `event` \| `sql`     |

Without this section the signal runs with all three types. An unknown
type is an error with the exact path (`$.contracts.types`).

### `policy` (optional)

The deployment's own sensitivity policy: a level → allowed-LLM-adapters
map, validated with karajan-rag's `validateSensitivityPolicy` (all three
levels are mandatory):

```json
{
  "policy": {
    "confidential": ["ollama"],
    "internal": ["ollama", "azure-openai"],
    "public": ["claude", "codex"]
  }
}
```

Without this section the engine's `createDefaultSensitivityPolicy()`
rules. An explicitly requested adapter the policy does not allow for the
effective level is an error — it is never silently downgraded to another
adapter.

## Sensitivity

Levels and their default inherit karajan-rag's model
(`SENSITIVITY_LEVELS`, `DEFAULT_SENSITIVITY`): `public` | `internal` |
`confidential`, safe default **`internal`**. The effective level governs
which LLM adapters the policy allows in F2/F3 judgments.
