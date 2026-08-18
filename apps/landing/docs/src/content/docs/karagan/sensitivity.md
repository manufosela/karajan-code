---
title: 'Sensitivity and privacy'
description: 'public/internal/confidential levels per corpus or path prefix, policy-driven provider routing and PII redaction in depth.'
---

<!-- translated-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · source-sha256: c00a67b395fc4e0a1fcbad2e1e3ab4d08cdb4aea0fa50af7e0f97ebe00bad2e7
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

Since 0.7.0 the easy layer applies the [sensitivity policy](https://github.com/manufosela/karajan-rag/blob/v1.5.0/docs/security/sensitivity-audit.md)
end to end (ADR-005 §6). Declare your corpus level in
`karajan.config.json`:

```json
{
  "easy": {
    "sensitivity": "internal",
    "sensitivityRules": [
      { "prefix": "docs/public/", "level": "public" },
      { "prefix": "finance/", "level": "confidential" }
    ]
  }
}
```

- **Levels**: `public` | `internal` | `confidential`. With nothing
  declared, everything counts as `internal` (safe default: nothing is
  ever assumed public). Prefix rules are exceptions; the first match
  wins.
- **At index time**, every document is tagged with its level and the
  chunks inherit it in the store.
- **In `query --answer`**, the effective level is the **maximum** of the
  retrieved chunks: a single `confidential` chunk in the context makes
  the whole answer confidential. The default policy allows:
  `confidential → ollama` (local), `internal → ollama and private
  clouds`, `public → any provider`.
  - An explicit `--adapter` not allowed for the level → **error** with
    the allowed list (what you asked for is never silently downgraded).
  - Config/default adapter not allowed → it routes to the first allowed
    provider, warning on stderr.
- **In `eval --judges`**, declare the level with `--sensitivity`
  (default `internal`); disallowed judges are rejected before anything
  is sent.
- **Defense in depth**: everything leaving towards an LLM additionally
  goes through `redactPII` (emails, phone numbers, national IDs, cards,
  IBAN).
- Indexes created before 0.7.0 carry no tag: their chunks count as
  `internal`. Reindex to apply your rules.
