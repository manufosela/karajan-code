# Simulating provider quota exhaustion (`KJ_SIMULATE_QUOTA`)

Flat-rate subscribers (Claude Pro, Gemini Code Assist Standard, Codex
subscription tiers, …) almost never see the real "weekly usage limit"
stderr line that Karajan's rate-limit detector listens for. That made it
impossible to verify end-to-end that:

- the run halts cleanly when a coder / refactorer / reviewer hits a
  quota cap,
- the session is persisted under `~/.karajan/standby/<sessionId>.json`,
- `kj standby list` finds it back, and
- `kj standby resume <sessionId> --force` rehydrates it.

`KJ_SIMULATE_QUOTA` is a **testing / demo hook** that injects a synthetic
"weekly limit. resets at <ISO>" line into the next agent's stderr at a
chosen iteration, without consuming any real quota. The existing
`detectRateLimit` branch picks it up; the existing standby + Brain
Recovery wiring takes over from there.

> This is for testing and dogfooding only — it does **not** alter your
> real provider state.

## Usage

```bash
KJ_SIMULATE_QUOTA=after-iter-2 \
KJ_SIMULATE_QUOTA_RESET=2026-06-02T15:30:00Z \
kj run "build a hello-world CLI"
```

After iteration `2`, the next coder execution returns a synthetic stderr
line, the coder stage emits `coder:hibernate` / enters standby, and the
session is written to `~/.karajan/standby/<sessionId>.json`. Resume with:

```bash
kj standby list
kj standby resume <sessionId> --force
```

## Variables

| Env var | Required | Default | Meaning |
|---|---|---|---|
| `KJ_SIMULATE_QUOTA` | yes | — | `after-iter-<N>` — fire on iteration `N` (1-based). Anything else logs a one-shot warning and is ignored. |
| `KJ_SIMULATE_QUOTA_RESET` | no | `now + 1h` (ISO) | The `resets at <ISO>` timestamp embedded in the synthetic line. |
| `KJ_SIMULATE_QUOTA_AGENT` | no | `claude` | Which provider to match. Accepts `claude`, `codex`, `gemini`, or `any`. |

## Which stages are wired

The simulator fires on the same three call sites that already check
`detectRateLimit`:

- coder stage (`src/orchestrator/stages/coder-stage.js` — `runCoderStage`)
- refactorer stage (same file — `runRefactorerStage`)
- reviewer stage (`src/orchestrator/stages/reviewer-stage.js`)

If the active agent in that stage matches the configured
`KJ_SIMULATE_QUOTA_AGENT` (or you set it to `any`), the result is
mutated to `ok=false` with the synthetic line prepended to `result.error`
before the existing rate-limit detector runs. No other code paths
change.

## What does **not** happen

- No fallback agent is invoked (the synthetic line goes through the
  standby branch, not the rate-limit-with-fallback branch — that is
  intentional, so you can demo a single-provider hibernation cleanly).
- No real provider quota is consumed.
- The simulator is a no-op when `KJ_SIMULATE_QUOTA` is unset, so it is
  safe to leave the wiring in place in production builds.

Tracked in `KJC-TSK-0493`.
