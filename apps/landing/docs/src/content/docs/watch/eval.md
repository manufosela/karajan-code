---
title: 'Eval and calibration'
description: 'A golden set of real incidents: precision/recall@k of the ranking, usable as a CI gate when thresholds or embedder change.'
---

<!-- translated-from: manufosela/karajan-watch@v0.3.0:docs/eval.md · source-sha256: f3daa81b90f69c8b08eeaedcc480e0f9b2b3947e9f6380ba2fa9a6f92aa34213
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

Calibrating `impact.thresholds` is not done by eye: it is measured
against a **golden set of real past incidents** of the organization —
changes that caused known collateral damage. The golden set lives in the
deployment repo (it contains real diffs: it is private); here, only the
format and the mechanics.

The eval runs the pipeline with **pure signals** (retrieval +
co-changes, no LLM judgment and no delivery): reproducible, cheap
metrics with no adapter dependency. It does not measure LLM judgment
quality — a documented limit.

## Golden set format

```json
{
  "thresholds": { "precision": 0.5, "recall": 0.6, "k": 10 },
  "cases": [
    {
      "name": "timeout change that broke the consumer",
      "repoName": "backend-api",
      "diff": "diff --git a/src/api.js b/src/api.js\n…",
      "expectedImpacted": ["web-frontend/src/api-client.js"]
    }
  ]
}
```

- `thresholds`: the aggregate gate. `precision`/`recall` in `[0, 1]`
  (omitted ones are not enforced); `k` is the ranking cutoff (default
  10).
- `cases[].expectedImpacted`: namespaced `repo/…` paths that really were
  affected by that change.
- Strict validation: an unknown key or an out-of-range value = an error
  with the exact path.

## Usage

```bash
karajan-watch eval \
  --config karajan-watch.config.json \
  --workspace .kjw-workspace \
  --golden golden-incidents.json
```

Output: precision/recall@k per case and aggregate. If the aggregate
falls below the thresholds → `FAILED` and exit code 1 (usable as a CI
gate after changing thresholds, embedder or karajan-rag version).

## Metrics

- `precision@k` = hits / returned candidates (up to `k`).
- `recall@k` = hits / expected files.
- Aggregate = simple mean over the cases.
