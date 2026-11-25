---
title: Observability and review truth
description: What kj records about its own work, the Usage and Accounts pages of the HU Board, how kj report measures whether reviews are truthful, and the OpenTelemetry seam (opt-in, and not sending spans yet).
---

kj keeps a small, local record of what it does, so that you can ask "what did this cost?" and "can I trust this review?" and get an answer from files, not from a model. This page says what is recorded, where to read it, and what is not built yet.

## What kj records, and what it never records

| Record | Where | What it holds |
| --- | --- | --- |
| Usage | `~/.karajan/usage/YYYY-MM.jsonl` (one file per UTC month) | One line per agent call kj launched: when, project, account, role, duration, tokens, cost, lines added and removed. |
| Repo traces | `.karajan/traces/` in the project | Local logs of what happened in that repo, for example which agents are working now (`agent-activity.jsonl`) and the attempts of the commit gate. |
| Decision log | `.karajan/policy-decisions.jsonl` | What the gates decided (allow, warn, deny, exempt) and the Steward's sweeps, chained by hash so a broken chain is detectable. |
| Review verdicts | `.karajan/reviews/` | The verdict of each cross-AI review, which `kj report` reads. |

The usage record holds no prompts, code or keys: it says who ran what, for how long and at what cost, and nothing else. The repo traces can hold content: a denial keeps the exact command it denied, and a review verdict keeps the findings, which quote code. All of it stays on your machine: kj reads these files, it does not upload them.

## The HU Board: Usage and Accounts

Start the board (`kj board start`) and open two pages from its header.

**Usage** (`/usage.html`) shows every agent call kj launched in a range of months. Pick a project (or every project), a range with **From** and **To**, and group by day, month, year or total. Each row sums, per project and account, the calls, tokens in and out, cached tokens, cost, duration and lines added and removed. A figure stays empty while no call of the group reported it, it is never shown as zero. With one project picked, **Export CSV** downloads that project's calls of the **To** month.

**Accounts** (`/accounts.html`) shows the provider logins kj knows (claude and codex), the order each project tries them in, their pace, and the rescue rules. It reads `~/.karajan/accounts.json`, and from `~/.karajan/rescue.json` only the rules and whether a key exists. It names a project by its last path segment instead of its full path, and never carries a key: the rescue section only says whether a key exists. Every change you make there runs the same `kj account` command you would type in a terminal. See [Several accounts](/docs/v4/accounts/).

## Review truth in `kj report`

A reviewer can cite a line that does not exist. kj checks that without a model. For each blocking finding it looks for three things: the file is in the project, the line exists in that file, and the code the finding quotes between backticks is within three lines of it (anywhere in the file when no line is cited). A finding outside the diff still anchors, and one that names no file is taken as about the whole diff. A finding that does not hold is kept apart as **not anchored**. It does not block. A security or critical finding keeps blocking even when it does not anchor. kj never turns a rejection into an approval.

When you run `kj code --retry`, the findings that hold go to the coder as the review. The ones that do not anchor go in a separate **Not verified** section that says not to fix them, because they may not be there.

`kj report` then prints a **Cross-AI review truth** block, read from `.karajan/reviews`:

- per reviewer: how many findings, and how many (and what share) were not anchored to the cited code;
- correction rounds: the mean number of rejections before an approval;
- Solomon arbitrations: how many, and how many ruled approve or reject.

The rejections signed by kj's own gates (sonar, rag-first, mutation...) are counted on their own line, never as a reviewer or a correction round.

A rejection saved before this check existed has no anchoring data. It is counted apart as "not measured", never as anchored. A high not-anchored share for a reviewer is a reason to look at that reviewer, not a verdict on it.

## `kj stage`

`kj stage` is a live view of who is working in your repos right now. It reads the files kj already writes in the repo (the Sentinel's denials, the decision log, the commit gate, the method checks, agent activity, cards, review verdicts and handoffs), and its hook never blocks your agent. It is a view: it keeps nothing of its own.

## OpenTelemetry

kj has the seam for OpenTelemetry spans. **It does not send spans yet.** The tracer, the part that exports them, is the next slice. What exists today is the decision of when a span is wanted and what it may carry:

- **Opt-in.** It is on only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. `OTEL_SDK_DISABLED=true` turns it off even then. With neither set, nothing is imported, no socket opens and no file is written.
- **An allow-list of attributes.** A span can carry only `kj.card`, `kj.role`, `kj.outcome`, `kj.provider`, `kj.model`, `kj.duration_ms`, `kj.tokens_in`, `kj.tokens_out` and `kj.cost_usd`. A string value longer than 200 characters is dropped. Prompts, code and keys are not on the list.
- **Preview.** `kj telemetry preview` prints the exact span a role call would carry and whether OpenTelemetry is on or off. It never opens a socket. `kj telemetry status` is a different switch: it says whether kj's anonymous usage telemetry is on or off.

## What is coming

An **Observability** section on the HU Board (ADR 0068), built on the same records. The page is not built yet; its first aggregators (`src/observe/`) are.
