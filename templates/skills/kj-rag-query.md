# kj-rag-query — Query Project RAG index

Query the Project RAG (vector store + embedder) and return the top-K most relevant chunks of the indexed project: plans, onboarding briefs, and (optionally) source code.

Use this when you need prior context about the project before deciding, refactoring, planning, or coding — without scanning the filesystem manually.

## Your task

$ARGUMENTS

## How it works

This skill is a thin wrapper over the Karajan CLI:

```
kj rag query "<text>" [--scope <all|plans|onboarding|code>] [--top-k <n>] [--json]
```

Parse `$ARGUMENTS` as the natural-language query plus optional flags:

- `--scope <s>`: restrict retrieval to one source bucket. Default: `all`.
  - `plans` → indexed plan JSON files (HU titles, scope, blocked_by).
  - `onboarding` → onboarding briefs from `~/.karajan/onboarding/`.
  - `code` → indexed source files (only present if user ran `kj rag index --with-sources`).
- `--top-k <n>`: number of chunks to return. Default: 3. Max recommended: 10.
- `--json`: emit raw JSON (use when piping into another tool).

If `$ARGUMENTS` is empty, print a one-line usage hint and stop.

## Behavior contract

1. **Empty store**: if the CLI replies with `empty: true`, do NOT block the conversation. Tell the user once: "RAG index is empty — run `kj rag index` to seed it" and continue without prior context.
2. **Zero hits**: if the store has chunks but no match scored above threshold, say "no relevant prior context" and continue.
3. **Hits returned**: render each as a short block — `[score] source — snippet` — and use them as background context for the user's actual question. Do NOT dump raw JSON unless `--json` was passed.
4. **Never re-validate flags**. Pass `--scope`/`--top-k` straight to the CLI; the CLI is the source of truth.

## Examples

User: `/kj-rag-query how does the retriever rank chunks`
→ `kj rag query "how does the retriever rank chunks"`

User: `/kj-rag-query auth flow --scope plans --top-k 5`
→ `kj rag query "auth flow" --scope plans --top-k 5`

User: `/kj-rag-query --scope onboarding architecture`
→ `kj rag query "architecture" --scope onboarding`

## Why this exists (Camino B)

Hosts that load Karajan as Skills (Claude Code without MCP, Cursor without MCP) cannot reach the `kj_rag_query` MCP tool. This skill bridges that gap with the same retrieval contract.
