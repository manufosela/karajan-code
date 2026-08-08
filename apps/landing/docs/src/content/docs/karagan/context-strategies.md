---
title: 'The context-strategy engine'
description: 'rag, cag and hybrid over the same index, plus eval --compare-modes to decide with data which context travels to the model.'
---

<!-- translated-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · source-sha256: 196b3ea9c227741fdd59b52e132390f705c13a3962c3166ce45370f5431d4b2b
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

The central decision of any RAG is **which context travels to the
model**. karajan-rag does not impose it: over the same index it offers
three strategies (`--mode rag|cag|hybrid`), all through the same guarded
path (sensitivity policy + PII redaction). `rag` is the default you have
already seen: the top-k chunks from hybrid retrieval.

## CAG mode: the full corpus as context

For small/medium corpora, `--mode cag` (Cache-Augmented Generation)
skips retrieval and loads **the whole corpus** into the model context:

```bash
karajan-rag query "summarize the architecture" ./my-project --answer --mode cag
```

- The context is **deterministic and stable** (ordered by path): same
  corpus → same prompt, which lets the provider amortize its
  prompt cache across queries.
- The effective sensitivity is the **maximum across the whole manifest**
  — the entire corpus travels here, so the gate is stricter than in RAG
  by design. PII redaction applies just the same.
- Budget with explicit failure (`--max-context-chars`, default 400K
  characters ≈ 100K tokens): if the corpus does not fit, an error
  reports the real size and the alternatives — **never a silent
  truncation**.
- It needs no vector store to answer (the manifest suffices), but it
  does need an indexed corpus.

And the middle ground, `--mode hybrid`: retrieval **selects** the
relevant files and the context carries those files **whole** (not
fragments), with the ones that do not fit the budget declared in the
log. Ideal when chunks fall short but the whole corpus does not fit.

Rule of thumb: corpus that fits in context and questions asking for a
global view → `cag`; large corpus and pinpoint questions → `rag`; large
corpus and questions that require understanding entire files →
`hybrid`. Unsure about YOUR corpus? Decide with data:

```bash
karajan-rag eval golden.json --compare-modes
```

It compares offline the retrieval recall against the context cost of
each mode and emits a recommendation justified with numbers.
