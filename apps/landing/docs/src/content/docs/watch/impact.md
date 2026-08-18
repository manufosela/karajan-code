---
title: 'Cross-repo impact'
description: 'Four signals — retrieval, git co-changes, contracts and LLM judgment — and a risk ranking with evidence, never a probability.'
---

<!-- translated-from: manufosela/karajan-watch@v0.3.0:docs/impact.md · source-sha256: f0e0a02ae9675badcaf0c8a4f2e9f2cf9b26b45d749da3257a2a2fd32d812493
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

After every merge in an observed repo, the pipeline combines four
signals and produces a **risk ranking with evidence** — never a
"probability":

1. **Retrieval**: every chunk of the diff as a query against the
   multi-repo `code` corpus, excluding the origin repo
   (`src/retrieval.js`).
2. **Git co-changes**: what the other repos historically touched near
   changes in the same areas (`src/cochanges.js`).
3. **Contracts**: contract identifiers in the diff — HTTP routes, event
   topics and SQL tables — searched **literally** in the other repos
   (`src/contracts.js`). It is the only signal that is not resemblance
   but **declared coupling**: if your diff touches `/api/v1/users/:id`
   and another repo contains that string, that repo consumes you.
4. **LLM judgment**: an adapter allowed by the sensitivity policy
   weighs candidates, co-changes and contracts, and emits a structured
   verdict (`src/judgment.js`).

### Why contracts rank first

Signals 1, 2 and 4 are heuristics; signal 3 is evidence. That is why a
file with a shared contract **enters the ranking even if retrieval never
brought it** (score 0) and sorts above the rest. And among them, the
**broken** ones come first: an identifier that disappears from the diff
is exactly what breaks its consumer. An identifier that appears in both
added and removed lines is still alive (it moved) and does not count as
a break.

Verification is literal over the retrieved chunk's content: a
high-scoring hit that does not contain the string is discarded. Cost:
one query per identifier, reusing the retrieval connection.

The report (markdown, PII redacted) is delivered to the config's
`notify.targets`: a PR comment and/or an https webhook. A failed signal
or an unreachable target = red job.

## CLI

```bash
karajan-watch impact \
  --config karajan-watch.config.json \
  --workspace .kjw-workspace \
  --repo backend-api \
  --diff merge.diff        # or '-' for stdin
  # [--corpus code] [--no-deliver] [--pr-number 42]
```

It prints the markdown to stdout. The `pr-comment` target needs
`GITHUB_REPOSITORY`, `GITHUB_TOKEN` and `--pr-number`.

## Reusable workflow

[`impact.yml`](https://github.com/manufosela/karajan-watch/blob/v0.3.0/.github/workflows/impact.yml)
mounts the multi-repo workspace **with history** (`git-depth`, default
200 — the co-change signal needs it; F1 ingestion clones at depth 1),
extracts the `base-sha..head-sha` diff of the merged repo and runs the
CLI:

```yaml
# deployment repo: .github/workflows/on-merge.yml
jobs:
  impact:
    uses: manufosela/karajan-watch/.github/workflows/impact.yml@main
    with:
      org: my-organization
      repo: ${{ github.event.client_payload.repo }}
      base-sha: ${{ github.event.client_payload.base }}
      head-sha: ${{ github.event.client_payload.head }}
      pr-number: ${{ github.event.client_payload.pr }}
      # Without an LLM adapter available on the runner, turn it off: the
      # pipeline runs with the three deterministic signals instead of
      # failing red.
      # judge: false
    secrets:
      REPOS_TOKEN: ${{ secrets.REPOS_TOKEN }}
      # Only if your store is pgvector. With lancedb there is no secret to create.
      PG_URL: ${{ secrets.PG_URL_CODE }}
```

The workflow **installs only the store backend** you declare in the
config (`@lancedb/lancedb` or `pg`) and, if your store is file-based,
restores the corpus the ingestion left. The report is also published as
a job artifact, to read or archive it without depending on the log.

This block is not written from memory: it is what the self-test in
[`kjw-workflows-selftest.yml`](https://github.com/manufosela/karajan-watch/blob/v0.3.0/.github/workflows/kjw-workflows-selftest.yml)
runs on every PR that touches the workflows.

## Known limits

- The adapter policy is karajan-rag's default
  (`createDefaultSensitivityPolicy`); making it configurable from
  `karajan-watch.config.json` is a future schema extension.
- Calibration with a golden set of real incidents (ranking
  precision/recall, tuning `impact.thresholds`) is a future eval card.
