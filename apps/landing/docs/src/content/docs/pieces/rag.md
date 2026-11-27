---
title: The project RAG
description: The project's memory, an index your agent asks before it assumes. What it is, why it exists, when it acts, how you use it and what it does not do.
---

## What it is

The project RAG is a search index of your repository. Your agent asks it in plain words ("where is the review verdict stored?") and gets back the files and fragments that answer. It lives in your project, in `.karajan/rag.db`, one index per project.

It indexes what git lists (tracked files and untracked ones not ignored), and leaves out what should not be in an index: what `rag.exclude` and `.ragignore` name, files that may hold secrets (`.env`, keys), lockfiles, minified files, maps, snapshots, binaries and files over 512 KB.

## Why it exists

An agent that does not know where something lives guesses, and a guess in a large codebase usually lands on the first file that looks right. The twin it did not look at, the same idea implemented again three folders away, is where the next bug comes from.

So the method is: ask before you assume. The RAG answers with what the code really is today, not with what the agent remembers or imagines.

## When it acts

| Moment | What happens |
|---|---|
| **The agent asks** | `kj rag query "<question>"`, or the `kj_rag_query` tool in Claude Code. Before each query, kj reindexes the files that changed (up to 25 by default). |
| **Before an edit** | The Sentinel lets the agent edit a source file only if one of the session's queries returned that file or one in its folder. If the file is missing from the index, kj indexes it on the spot and still asks for the query. |
| **In the review** | `kj review` checks the session's queries covered every source in the diff. The files those queries returned and the diff does not touch go to the reviewer by name: the change may be incomplete. |

What the session asked and what came back is written in the [ledger](/docs/pieces/ledger/), so the gates check a fact, not the agent's word.

## How you use it

- `kj rag index` builds the index. `kj env install` does it for you if there is none.
- `kj rag query "<question>"` asks it. `--scope code|plans|onboarding|all` narrows where it looks and `--top-k` how many answers.
- In Claude Code, `kj env install` registers the RAG as an MCP server in your personal configuration (never in the shared `.mcp.json`), so the agent has `kj_rag_query` as a native tool.
- To leave something out, add it to `.ragignore` or `rag.exclude`. That is governance configuration: you change it, the agent cannot.

## What it does not do

- **It does not leave your machine.** The index is a local file; queries do not go to an outside service.
- **It does not index secrets on purpose,** and what you exclude stays out.
- **It is not proof the code is right.** It says where things are; whether the change is correct is for the [quality checks](/docs/pieces/quality/) and the [cross review](/docs/pieces/cross-review/).
- **An empty index is not an answer.** kj says so and gives the remedy, instead of letting the agent read silence as "nothing found".
