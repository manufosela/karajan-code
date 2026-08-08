---
title: 'Design and phases'
description: 'The problem (context of ALL the code, collateral damage, stale docs), the three-layer architecture and the product phases.'
---

<!-- translated-from: manufosela/karajan-watch@v0.3.0:docs/design.md · source-sha256: 41217e6682d8f88bd10875c38d23a42acf531e5d12c48480b1ea072586ad6b81
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

> Kickoff document (2026-07-23), distilled from the design session in
> karajan-rag. It is the context contract for any session working here:
> read it whole before touching code.

## 1. The problem

An organization with N repos and AI agents working on them needs:

1. Agents with **context of ALL the code**, not just the repo they work
   in — a shared RAG, always fresh.
2. To know, when something merges into one repo, **which other repos may
   be affected** (collateral damage) — the core idea.
3. To know **which documentation goes stale** with every code change.

## 2. Three-layer architecture

- **karajan-rag** (engine, exists): index/query/serve, hybrid retrieval,
  incremental manifest, sensitivity policy + redactPII (audited),
  lancedb/pgvector stores, validated GCP Terraform, eval with golden set.
- **karajan-watch** (this repo, product): the generic orchestration. No
  data from any organization. Publishable on npm.
- **A deployment repo per organization** (private, theirs): the concrete
  configuration — repo list, sensitivity levels, infra, thresholds,
  notification targets, calibration golden set.

Each organization's real deployment lives in its own repo, in its GitHub
org, with corporate identity — NOT here.

## 3. Product components

### 3.1 Ingestion on merge (F1)

- **Reusable GitHub Actions workflow** (`.github/workflows/` + a
  publishable action): on merge to the main branch of an observed repo →
  checkout → `karajan-rag index --store pgvector` of the workspace.
- The reindex is incremental (karajan-rag's manifest): only what the PR
  touched is reprocessed. The shared manifest lives next to the corpus
  (GCS in the GCP deployment).
- **Local embedder on the runner** (transformers) — the code NEVER
  travels to a third-party embedder. Corpus sensitivity is declared by
  the deployment layer; safe default `internal`.
- Two separate corpora: `code` (multi-repo, namespaced paths `repo/…`)
  and `docs`. Separate pgvector tables.
- Serving agents: `karajan-rag serve` (MCP/HTTP) over each corpus.
  **Upstream gap detected**: multi-corpus serve in one process —
  meanwhile, one service per corpus.

### 3.2 Cross-repo impact pipeline (F2 — the heart)

Honesty first: **vector similarity is not causal impact analysis**. The
pipeline combines three signals:

1. **Retrieval**: every chunk of the merged diff as a query against the
   `code` corpus, filtering out the origin repo → candidates by semantic
   similarity + BM25 (function names, endpoints, schemas). *Upstream
   gap*: per-prefix/repo query filter; meanwhile it filters post-hoc on
   `hit.source`.
2. **Git co-changes**: mining history — when area X of repo A was
   touched, what changed in repo B in nearby windows? A cheap signal,
   complementary and content-independent.
3. **LLM judgment**: an adapter ALLOWED BY THE POLICY (corpus level)
   receives diff + candidates + co-changes and emits a structured
   verdict: what is affected, why, severity.

Output: a **risk ranking with evidence** (never a calibrated
"probability") → a PR comment / a notice to whatever channel the
deployment layer configures. Calibration: a golden set of real past
incidents (karajan-rag's eval mechanics) to measure the ranking's
precision/recall and tune thresholds.

### 3.3 Documentation drift (F3)

Same skeleton as 3.2 with the `docs` corpus as the target: diff →
retrieval over docs → candidates "these sections mention what you
changed" → optional LLM judgment to filter noise → a "docs to update"
report with section-by-section links.

## 4. Hard rules inherited from the family

- **Sensitivity first**: an organization's code is `internal` at
  minimum. Local embedders; LLM judgments only through adapters the
  policy allows for the effective level; redactPII on every output.
- **No silent fallbacks**: an ingestion that cannot index = red job,
  never "green with a half-built index".
- **Privacy in public artifacts**: this repo is public — never data,
  private repo names or references to concrete organizations in code,
  tests, docs or examples.
- **Generic or it does not get in**: any organization-specific value is
  a parameter of the deployment layer.

## 5. Phases

- **F1 — Shared RAG, alive**: reusable ingestion workflow + multi-repo
  workspace conventions + serve for agents. Reuses almost everything
  from karajan-rag; the plumbing phase.
- **F2 — Cross-repo impact**: the three signals + ranking + PR comment.
  Includes the co-change miner and the judgment prompt with structured
  output.
- **F3 — Docs drift**: docs corpus + affected-sections report.
- **Cross-cutting**: generic features that emerge are proposed upstream
  to karajan-rag (multi-corpus serve, per-prefix query filters…), not
  duplicated here.

## 6. Open decisions (ask the user)

- Where the first deployment's ingestion runs: CI runners vs a Cloud Run
  job.
- Name/visual brand within the family (kaWATCHan? 😄 — pending).
- Exact scope of the impact comment on PRs (never block the merge, only
  warn?).
