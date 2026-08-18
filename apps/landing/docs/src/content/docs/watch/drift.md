---
title: 'Documentation drift'
description: 'Which documentation sections mention what you just changed — with the hard code↔docs link that contracts provide.'
---

<!-- translated-from: manufosela/karajan-watch@v0.3.0:docs/drift.md · source-sha256: 7f392ad905dfc8f18ce5fef766dccf4bf27a51f21a12d29908aabf0fdbc96652
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

Same skeleton as the [impact analysis](../impact/) with the `docs`
corpus as the target: after every code merge, the diff is queried
against the indexed documentation and the report lists **which sections
mention what changed** and may go stale, with a `file:line` link and
evidence.

- Retrieval reuses `findImpactCandidates` and filters post-hoc to
  documentation files (`DOC_EXTENSIONS`: md, mdx, rst, txt, adoc) — a
  KJR-PRP-0004 workaround until queryIndex exposes `sourceType`.
- **It includes the repo's own documentation.** Unlike impact analysis,
  which looks at the OTHER repos by definition, here the first document
  left lying is usually the README sitting next to the code that
  changed. What is left out are **the files the diff itself touched**:
  those are not stale documentation, they are the change.
- **Contracts: the hard code ↔ documentation link.** The same
  identifiers F2 mines — HTTP routes and OpenAPI paths, event topics,
  SQL tables — are searched **literally** in the docs corpus. A manual
  containing the string `/api/v1/users/:id` that the diff just deleted
  is not semantic resemblance: it is proof that the document lies. That
  is why a section with a literal citation **enters the report even if
  retrieval never brought it** (score 0) and sorts ahead of those found
  by similarity alone; first the ones citing something already removed.
  The report names the concrete identifier. It turns off with
  `$.contracts.enabled: false`, just like in F2.
- The **LLM judgment is optional** (`--judge`): drift is an
  informational signal and the default avoids LLM cost. When enabled, it
  reuses F2's judgment (config policy, strict verdict, redactPII) and
  the verdict acts as a noise filter: only sections the judgment
  confirms are listed. A literal citation is the exception: an opinion
  cannot kill it, because the document names something that no longer
  exists.
- Zero drift = an explicit report (never silence); a failed signal or an
  unreachable target = red job.

## CLI

```bash
karajan-watch drift \
  --config karajan-watch.config.json \
  --workspace .kjw-workspace \
  --repo backend-api \
  --diff merge.diff \
  # [--judge] [--no-deliver] [--pr-number 42]
```

## Reusable workflow

[`drift.yml`](https://github.com/manufosela/karajan-watch/blob/v0.3.0/.github/workflows/drift.yml)
— like `impact.yml` but without deep history (it does not use
co-changes):

```yaml
jobs:
  drift:
    uses: manufosela/karajan-watch/.github/workflows/drift.yml@main
    with:
      org: my-organization
      repo: ${{ github.event.client_payload.repo }}
      base-sha: ${{ github.event.client_payload.base }}
      head-sha: ${{ github.event.client_payload.head }}
      judge: false
    secrets:
      REPOS_TOKEN: ${{ secrets.REPOS_TOKEN }}
      # Only if your store is pgvector. With lancedb there is no secret to create.
      PG_URL: ${{ secrets.PG_URL_DOCS }}
```

The workflow **installs only the store backend** you declare in the
config and, if it is file-based, restores the corpus the ingestion left.
The report is also published as a job artifact, to read or archive it
without depending on the log.

This block is not written from memory: it is what the self-test in
[`kjw-workflows-selftest.yml`](https://github.com/manufosela/karajan-watch/blob/v0.3.0/.github/workflows/kjw-workflows-selftest.yml)
runs on every PR that touches the workflows.

## Known limits

- The `docs` corpus today indexes the whole workspace (code included):
  cost and noise accepted until KJR-PRP-0005 (per-corpus include
  globs).
- The section anchor is the hit's line, not the markdown heading:
  semantic section chunking belongs to the engine.
