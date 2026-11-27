---
title: The cross review
description: Every diff reviewed by a different AI before it is committed, with the verdict bound to that exact diff. What it is, why it exists, when it acts, how you use it and what it does not do.
---

## What it is

Before a change is committed, another AI reviews it. `kj review --staged` sends the staged diff to the reviewer of your panel, which approves it or rejects it with findings. The answer is a **verdict**, and it is bound to that exact diff: kj keys it by a hash of the diff and stores it in `.karajan/reviews/`.

Your panel says who does what. By default the coder is Claude and the reviewer is Codex; a third AI arbitrates disagreements (Solomon). You set it in the configuration, and kj warns on every review when something pins a different reviewer.

## Why it exists

An agent that reviews its own work finds what it already believes. It wrote the code with an idea in mind, and it reads the code with that same idea. A different model has other blind spots, so it catches what the first one could not see.

The verdict is bound to the diff so it cannot be reused: change one line and the hash changes, so the change has to be reviewed again. "It was approved" always means "this was approved".

## When it acts

| Moment | What happens |
|---|---|
| **Before the commit** | `kj review --staged` runs the [quality checks](/docs/pieces/quality/) first, then the reviewer. The first rejection ends it and is stored as the verdict. |
| **At the commit** | The git hook (`kj review --check`) and the Sentinel let the commit through only with an approved verdict for exactly the staged diff. |
| **On the pull request** | `kj review --publish-pr <n>` publishes each commit's verdict with its hash. The `kj-verdicts` workflow recomputes every commit's hash and fails if one has no verdict, so a commit made with `--no-verify` is caught here. |

A diff too large for one prompt is reviewed in batches of whole files (up to 10). It is approved only if every batch is approved; a file too large to review becomes a blocking finding, never a silent pass. Each batch gets the facts of its own files: things kj computes without a model (the size, a new dependency, something shaped like a secret, an assertion removed from a test) and gives the reviewer to look at.

## How you use it

1. Stage your change by name and run `kj review --staged`.
2. Approved: commit. Rejected: fix the findings and review again. A correction from the other AI is the method working.
3. If you think a finding is wrong, do not argue in the code: `kj solomon --position "<why>"` asks a third AI. The arbiter has to be different from both the one that wrote and the one that reviewed. If it rules for you, the same diff gets an approved verdict. With `--finding <id>` only that finding is arbitrated.

**A security finding is never arbitrated.** If the reviewer marks it as security, or it talks about injection, secrets, authentication and the like, Solomon is not even called: it has to be fixed.

## What it does not do

- **It does not review a diff it did not see.** A verdict is for one hash. Rebase, amend or add a line, and the verdict no longer applies.
- **It does not let the agent of your session review itself.** kj never picks the host agent as reviewer; if no other agent is available, the review fails instead of falling back to a self-review. It does not check, though, that the reviewer differs from the coder your panel declares, so keep those two different.
- **It does not replace your tests.** The reviewer reads the code; the [quality checks](/docs/pieces/quality/) run it before.
- **It does not keep verdicts forever.** They expire after 14 days; nothing staged waits that long.
