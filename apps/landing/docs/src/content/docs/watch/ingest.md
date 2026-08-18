---
title: 'Ingestion on merge'
description: 'The reusable ingest.yml workflow: incremental reindex of the shared corpus on every merge, with a local embedder on the runner.'
---

<!-- translated-from: manufosela/karajan-watch@v0.3.0:docs/ingest.md · source-sha256: 76982842e48c995e620f7c9f9eba7f151a3eb9e4a0aed26691f0661c742ff46c
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

Every merge to the observed branch of a repo triggers the reusable
[`ingest.yml`](https://github.com/manufosela/karajan-watch/blob/v0.3.0/.github/workflows/ingest.yml)
workflow, which incrementally reindexes the shared corpus with
karajan-rag. The embedder runs LOCALLY on the runner: the code never
travels to a third-party embedder.

## Multi-repo workspace convention

The corpus is indexed from a workspace with **one subdirectory per
observed repo** (`workspace/<repo>/…`): paths are namespaced by repo and
never collide across repos.

The workspace must contain **the entirety** of the repos declared in the
config. This is not optional: karajan-rag's incremental manifest
invalidates (deletes from the store) files missing on disk, so indexing
a partial workspace would destroy the other repos' corpus.
`karajan-watch ingest` verifies it and fails red before touching
anything — same if an undeclared directory shows up.

The sensitivity declared in the config is stamped by generating the
`karajan.config.json` that karajan-rag reads at the workspace root:
global corpus level + one `sensitivityRule` per repo prefix.

## CLI

```bash
karajan-watch ingest \
  --config karajan-watch.config.json \
  --workspace .kjw-workspace \
  --corpus code   # code | docs
```

Any failure (invalid config, incomplete workspace, missing `PG_URL`
with the pgvector store, karajan-rag exiting non-zero) ends with a
non-zero exit code: **red job, never degraded success**.

## Usage from the deployment repo

In the organization's private deployment repo (where its
`karajan-watch.config.json` lives):

```yaml
# .github/workflows/reindex.yml of the deployment repo
name: reindex
on:
  workflow_dispatch:
  repository_dispatch:
    types: [repo-merged] # every observed repo emits it on push to main
jobs:
  ingest:
    uses: manufosela/karajan-watch/.github/workflows/ingest.yml@main
    with:
      org: my-organization
      corpus: code
    secrets:
      REPOS_TOKEN: ${{ secrets.REPOS_TOKEN }}
      PG_URL: ${{ secrets.PG_URL_CODE }}
```

The workflow **installs only the store backend** you declare in the
config: `@lancedb/lancedb` for `lancedb`, `pg` for `pgvector`, nothing
for `in-memory`. If the store is unsupported, the job fails saying so
instead of trying to index.

This block is not written from memory: it is what the self-test in
[`kjw-workflows-selftest.yml`](https://github.com/manufosela/karajan-watch/blob/v0.3.0/.github/workflows/kjw-workflows-selftest.yml)
runs on every PR that touches the workflows.

- `REPOS_TOKEN`: a token with read access to every observed repo.
- `PG_URL`: **only if your store is `pgvector`** — with `lancedb` there
  is no secret to create. The corpus connection. **One `PG_URL`
  (database or schema) per corpus**: karajan-rag's CLI uses a fixed
  table (`karajan_rag_chunks`), so `code` and `docs` cannot share a
  database — upstream gap on record (KJW-TSK-0003).

## Incremental manifest

The manifest (`workspace/.karajan/`) is preserved between runs with
`actions/cache`. If the cache is lost, the next run does a **full
reindex**: correct although slow, never a half-built index. Deployments
that need stronger guarantees (e.g. the manifest in GCS next to the
corpus) solve it in their deployment layer.

Reindexes are **serialized per corpus** (workflow `concurrency`, no
cancellation): two concurrent merges sharing a manifest would trample
each other; instead, the second waits for the first.
