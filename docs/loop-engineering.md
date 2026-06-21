# Loop engineering

> "Loop engineering is replacing yourself as the person who prompts the agent.
> You design the system that does it instead."

Through 2023–2024 the craft was **prompt engineering**: getting one good answer
out of one good prompt. Through 2025 it became **context engineering**: curating
exactly what the model sees on each call. The frontier in 2026 is **loop
engineering** — you stop prompting the agent by hand and instead design the
*control system* that prompts it, checks it, and decides what happens next, over
and over, until the goal is met or the loop hands back to you.

Karajan is a loop-engineering runtime. It was built around the loop before the
word caught on: a maker/checker pipeline, deterministic verification, a durable
state spine, and — since v3.7.0 — a configurable autonomy ladder. This page maps
the vocabulary of loop engineering onto what Karajan already does, honestly,
including the parts that are still on the roadmap.

## The shift in one line

| Era | You engineer… | The unit of work |
|-----|---------------|------------------|
| Prompt engineering | the prompt | one request → one answer |
| Context engineering | what the model sees | one well-fed request |
| **Loop engineering** | **the system that prompts** | **a recursive goal that runs to done** |

A loop is a *recursive goal*: you set the purpose, the system iterates, and it
terminates by either delivering the result or escalating to a human.

## The building blocks of a loop

The loop-engineering literature converges on a small set of building blocks.
Here is how each maps to Karajan:

| Building block | What it means | In Karajan |
|----------------|---------------|------------|
| **Maker / checker split** | One agent produces, others critique | The pipeline: a **coder** (maker) against **reviewer / tester / security** (checkers), with up to 24 specialized roles |
| **Verifier** | Checking is tests + gates, not vibes | TDD by default, executable acceptance tests per HU, SonarQube quality gates, deterministic guards, WebPerf Core Web Vitals gate |
| **Human gates** | Escalate risky/ambiguous, allow safe to proceed | The decision resolver, spec-review gates, checkpoints, and **Solomon** judging every reviewer rejection |
| **Autonomy levels** | Phased rollout: report → assisted → unattended | The `interactive \| assisted \| autonomous` axis (v3.7.0), surfaced as `kj autorun` |
| **Memory / state** | A durable spine outside any one conversation | Sessions on disk, the HU Board (`board.db`), per-session journals, the RAG index, standby/hibernate, `kj resume` |
| **Worktrees** | Safe parallel execution | Each HU runs in its own branch/worktree under `~/.karajan/worktrees/` |
| **Skills** | Persistent project knowledge | Role templates as plain markdown, the per-project RAG index, QMD wiki, and `kj harden` guidelines |
| **Plugins / connectors** | Tool access via MCP | Karajan *is* an MCP server (27 tools) and wraps the AI CLIs you already use |
| **Automations / scheduling** | Discovery & triage on a cadence | Partial today: `kj discover` (pre-run validation), the nightly drift workflow, RAG auto-reindex on merge. Scheduled auto-resume after a quota reset is on the roadmap (AUTO-D2) |

## Maker / checker is the heart

Most "AI coding" tools are a single agent in a loop with itself — it writes,
it reviews its own work, it convinces itself it's done. Karajan separates the
roles on purpose. The coder never grades its own homework. A reviewer, a tester,
and a security role each get an independent pass, and when a reviewer rejects
the coder, **Solomon** — a supervisor role — decides whether the rejection is a
real defect or just style noise. That separation is exactly the maker/checker
split loop engineering insists on, and it's why the loop converges instead of
spinning.

## Verification is deterministic, not "looks good"

A loop is only as trustworthy as its checker. Karajan's checkers are anchored to
ground truth that doesn't depend on a model's mood:

- **Acceptance tests** generated per HU, run after every coder iteration — all
  pass → approved, any fail → the failure is fed back with the exact error.
- **SonarQube** quality gates as a first-class pipeline stage.
- **Deterministic guards** that run before and after each agent, catching
  zero-file iterations, missing changes, and malformed output mechanically.

The Arbiter (v3.7.0) makes the priority order explicit when checkers disagree:
**acceptance tests outrank reviewer must-fix, which outranks nice-to-have.**

## The autonomy ladder (L1 → L2 → L3)

Loop engineering recommends rolling out autonomy in phases rather than flipping
a switch. Karajan ships that ladder as a single axis — `flag > env > config >
default`, defaulting to `interactive` so nothing changes until you ask:

| Level | Loop-engineering framing | Karajan mode |
|-------|--------------------------|--------------|
| **L1** | Report — the loop proposes, you act | `interactive` (gates ask you at every decision) |
| **L2** | Assisted — safe fixes proceed, risky ones escalate | `assisted` |
| **L3** | Unattended — runs to done, hands off on genuine blocks | `autonomous` (`kj autorun <spec>`) |

In `autonomous`, every would-be human decision routes through one choke point
that hands the call to the Arbiter, no pipeline stage blocks on a prompt, and a
wall-clock backstop guarantees the loop can't hang. It ends with a
**DELIVERED / INCOMPLETE** report listing any residual defects.

## Termination and handoff

A loop that can't stop is a bug, not a feature. Karajan terminates three ways:
the goal is met (DELIVERED), the goal is partially met and the gaps are reported
(INCOMPLETE, with residual defects listed), or a genuine blocker escalates to
you. Every run propagates an exit code, so `kj autorun` composes inside larger
scripts and CI.

## The honest caveat

Loop engineering's own warning is worth repeating: **unattended loops make
unattended mistakes.** Karajan is built to make that cheap to catch, not to
pretend it doesn't happen — the default stays `interactive`, autonomous runs
**list their residual defects** instead of hiding them, every HU lands on its
own branch behind a PR, and `kj-trash` snapshots destructive operations. The
loop does the work; you still own the verification.

## Further reading

- **[docs/specs/autonomous-delivery.md](./specs/autonomous-delivery.md)** — the
  design of Karajan's autonomy spine (the Arbiter, the decision resolver, the
  outcome report).
- **[docs/COMPARISON.md](./COMPARISON.md)** — how Karajan differs from
  API-calling AI frameworks.
- The term traces to essays and talks by **Addy Osmani**, **Boris Cherny** (head
  of Claude Code at Anthropic), **Peter Steinberger**, and **Cobus Greyling**,
  who each describe the move from prompting an agent to engineering the loop that
  prompts it.
