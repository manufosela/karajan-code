# Karajan Code vs AI Frameworks

> While Genkit, Mastra, LangChain and Vercel AI SDK call `/v1/messages`,
> Karajan orchestrates the AI CLIs your developers already use in their terminals.

This document positions Karajan Code against the main AI orchestration frameworks in the JavaScript ecosystem. It is intentionally opinionated and written for developers who have used one of those frameworks and are trying to place Karajan mentally.

## One-line summary

- **Genkit / Mastra / LangChain / Vercel AI SDK**: SDKs that sit between your app and a provider's HTTP API. Your app makes HTTP calls against `api.openai.com`, `api.anthropic.com`, etc. through the SDK.
- **Karajan Code**: a CLI-first orchestrator that spawns the coding CLIs (`claude`, `codex`, `gemini`, `aider`, `opencode`) as subprocesses and coordinates them as specialized pipeline roles (coder, reviewer, planner, security, …). Karajan does not call `/v1/messages` itself.

## Comparison table

| Axis                       | Karajan Code                                  | Genkit                         | Mastra                        | LangChain (JS)                  | Vercel AI SDK                   |
|----------------------------|-----------------------------------------------|--------------------------------|-------------------------------|---------------------------------|---------------------------------|
| Calls `/v1/messages` / provider HTTP API | ❌ No. Delegates to CLIs.          | ✅ Yes                         | ✅ Yes                        | ✅ Yes                          | ✅ Yes                          |
| Orchestrates existing AI CLIs | ✅ Yes (subprocess: claude, codex, gemini, aider, opencode) | ❌ No | ❌ No                         | ❌ No                           | ❌ No                           |
| Depends on cloud infrastructure | ❌ Runs fully local. Your laptop.         | ⚠️ Works local, but Firebase-leaning | ⚠️ Works local, cloud optional | ❌ Not directly                | ❌ Not directly                |
| Vanilla JS (no TS required)   | ✅ 100% vanilla JS (optional JSDoc typedefs) | ⚠️ TS-first                    | ⚠️ TS-first                   | ⚠️ TS-first                     | ⚠️ TS-first                     |
| Self-hosted                   | ✅ Ships as an npm CLI + MCP server.        | ✅ Self-hostable              | ✅ Self-hostable              | ✅ Self-hostable                | ✅ Self-hostable                |
| Shape of "unit of work"       | Pipeline Role (coder, reviewer, planner…)  | Flow                          | Workflow / Step              | Chain / Runnable                 | generateText / streamText       |
| Human-in-the-loop arbitration | Solomon (AI judge consulted by Brain)       | Manual                        | Manual                       | Manual                           | Manual                          |
| Session state                 | Files in `~/.karajan/sessions/` — resumable | In-memory / provider history  | Provider history              | Provider history                | Provider history                |
| Token billing                 | **Uses your existing CLI subscriptions**    | Pay per API call               | Pay per API call              | Pay per API call                 | Pay per API call                |

## What Karajan actually does under the hood

Two technical facts that are often miscommunicated — keep them straight:

### 1. It's subprocess, not PTY

Karajan invokes each CLI via `execa` / `child_process` with plain `stdin` / `stdout` / `stderr`. There is no PTY emulation.

You can see this in:

- [`src/agents/claude-agent.js`](../src/agents/claude-agent.js) — note `stdin: "ignore"` because `claude -p` runs non-interactively.
- [`src/agents/codex-agent.js`](../src/agents/codex-agent.js) — uses `input: task.prompt` to feed the prompt on stdin.
- [`src/infrastructure/command-runner.js`](../src/infrastructure/command-runner.js) — the DI adapter all agents route through (TSK-0316, v2.6).
- [`src/utils/process.js`](../src/utils/process.js) — the underlying `runCommand` wrapper around `execa`.

This matters: PTY-based orchestrators have to reason about terminal control sequences, window resizes, partial lines, and signal handling for interactive shells. Karajan sidesteps all of that. Each role run is a one-shot non-interactive invocation.

### 2. It's "subprocess fresco + state on disk", not "stateful CLI sessions"

Every time the coder role runs, it spawns a **fresh subprocess**. The CLI has no memory of the previous iteration. The memory lives in Karajan's session store:

- `~/.karajan/sessions/<session-id>.json` — the authoritative session state (see [`src/session-store.js`](../src/session-store.js)).
- `.reviews/<session-id>/` — per-session journal with `decisions.md`, `iterations.md`, `summary.md`, `tree.txt` (v2.6 journal suite).

What you gain:
- **Reproducible**: same input + same config → same (or replayable) output.
- **Resumable**: `kj resume <sessionId>` picks up exactly where a paused session left off — because the state is a set of files, not an open process.
- **No zombie processes** between iterations.

Frameworks that hold a live HTTP session or an in-memory chain have none of these properties by default.

## Mental mapping for devs coming from other ecosystems

- **Genkit developer**: think of Karajan's pipeline roles as "Flows that run over subprocess CLIs instead of REST APIs". The orchestration shape is similar; the substrate is different.
- **Mastra developer**: think of a Karajan role as a "Step" whose action is "spawn a CLI with this prompt and parse the output".
- **LangChain developer**: Karajan has no LCEL-style chain — the pipeline is explicit Node code. Solomon is the closest thing to `AgentExecutor`'s decision loop, but it's only consulted on real dilemmas (not every step).
- **Vercel AI SDK developer**: Karajan has no `generateText`. The equivalent is `kj code "task"` or `kj run "task"`, which delegates to the configured coder CLI subprocess.

## When to pick what

**Pick a framework (Genkit / Mastra / LangChain / Vercel AI SDK) when:**
- You're building a user-facing product that needs AI in its backend.
- You want to bill end users for token usage.
- You want streaming responses in a web UI.
- You own the provider relationship (API keys, billing, rate limiting).

**Pick Karajan Code when:**
- You want a **local dev-productivity tool** that drives the CLIs already on your machine.
- Your devs are already paying for Claude / Codex / Gemini / Aider / OpenCode subscriptions and you want to **reuse those seats** instead of a separate API bill.
- You want reviewable, SonarQube-gated, TDD-enforced code generation — not just raw model output.
- You want **pipeline-shape output artifacts** (commits, PRs, review reports) on disk.

The two categories are complementary, not competing.

## See also

- [README](../README.md) — headline summary and quickstart.
- [ARCHITECTURE](./ARCHITECTURE.md) — full pipeline internals.
- [karajancode.com](https://karajancode.com) — landing with feature cards and comparison view.
