---
title: 'Serve and configure'
description: 'MCP server for agents, HTTP API with a web playground, and karajan.config.json as project defaults.'
---

<!-- translated-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · source-sha256: 8c3fe4e889c4383c9fc1eb4a314855c118bb7af3bf883f60344e0937d1315d9c
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

## 3. Serve

### As an MCP server (for Claude Code and other agents)

```bash
claude mcp add my-rag -- karajan-rag serve /path/to/my-project
```

Exposes the `rag_query` and `rag_status` tools over stdio (JSON-RPC 2.0).

### As an HTTP API (with a web playground)

```bash
karajan-rag serve ./my-project --http --port 8080
# open http://localhost:8080/ → playground: question, mode (rag/cag/hybrid)
# and the always-visible guarantees (adapter used and gate level)
curl -s localhost:8080/health
curl -s -X POST localhost:8080/query -H 'content-type: application/json' \
  -d '{"question": "billing", "topK": 3}'
curl -s -X POST localhost:8080/answer -H 'content-type: application/json' \
  -d '{"question": "summarize the architecture", "mode": "cag"}'
```

The page is self-contained (zero external assets — it works in
deployments with no internet egress) and `--no-ui` turns it off to serve
the API only. The `/answer` defaults (adapter, topK) come from
`karajan.config.json`, exactly as in the CLI; the corpus path inventory
never travels over the network (only counts do). Authentication belongs
to the deployment layer (IAM/invoker on GCP).

## 4. Customize (optional)

```bash
karajan-rag init ./my-project        # wizard → karajan.config.json
karajan-rag init ./my-project --yes  # non-interactive (CI)
```

The config acts as project defaults (store, embedder, dimensions, topK,
adapter, sensitivity); CLI flags always win. Invalid config → explicit
error naming the exact key.
