---
title: Working without kj
description: How to contribute to a repo that kj governs without using kj yourself, and how the automatic AI review takes the place of kj review.
---

Using kj is each person's choice. The repo's rules bind everyone, and CI enforces them. This guide says what CI asks of a contributor who does not use kj, and how a repo's automatic AI review counts as the cross-AI review.

## What CI asks of everyone

- The change is a small, atomic PR, with its tests, and the suite is green.
- Every PR gets a cross-AI review, bound to the PR's last commit.
- **With kj**: `kj review --staged` before each commit, then `kj review --publish-pr <n>`. CI runs `kj review --verify-pr <n>`.
- **Without kj**: an automatic AI review on the PR, from a bot that kj can verify by its login (`github-actions[bot]`). The same check, `kj review --verify-pr <n> --automatic-review codex-state`, counts it.
- A manual review or a plain GitHub "Approve" does not count: nothing proves what it looked at.

## How the automatic AI review counts

When a PR has no kj review, kj looks for the repo's automatic review. It counts only if all of this is true:

- The **last** comment by `github-actions[bot]` that carries the lifecycle marker is the one that is read. Older comments do not matter.
- Its recommendation is `APPROVE`.
- `reviewed.head` and `observedHead` in the comment are both the PR's current head. A new push makes the old review stale until the bot reviews again.
- No finding has the status `active`. Fix it and let the bot review again.
- A `dismissed` finding counts only if it is `MINOR` and `dismissal.by` is someone who is not the PR author and has write access to the repo.
- `CRITICAL` and `MAJOR` findings are never dismissable: they have to be fixed.
- A PR that changes `.github/workflows/` never counts, because a workflow it brings could write the bot's comment. Get a kj review for it.
- A PR whose changed files `gh` cannot list in full never counts.

When something fails, `kj review --verify-pr` prints each problem, so you know what to fix.

## For maintainers: declaring it

In `.karajan/kj.config.yml`:

```yaml
review:
  automatic: codex-state
```

Then run `kj harden` and seal it. The `kj-verdicts.yml` it writes runs `kj review --verify-pr <n> --automatic-review codex-state --wait-automatic 20`: the check waits up to 20 minutes for the bot to review the PR's head and polls every 30 seconds. A new push cancels the old wait and starts a new one. It needs kj 5.35.0.

## The format kj reads (codex-state)

The comment of the bot has to be exactly this shape. Anything else fails closed: the review does not count.

- The first line is `<!-- codex-review-lifecycle:v1 -->`.
- Exactly one line is `**Recommendation: APPROVE**` or `**Recommendation: REQUEST_CHANGES**`.
- The last line is `<!-- codex-state:<base64 of JSON> -->`, exactly once.
- The JSON has the strings `status`, `reviewed.head`, `reviewed.base` and `observedHead`, and the array `findings[]`.
- Each finding has `id`, `severity` (`CRITICAL`, `MAJOR` or `MINOR`), `status` (`active`, `fixed` or `dismissed`), `path` and `line`. A dismissed one also has `dismissal.by`.

## Set up the bot in a repo that has none

Paste this into your coding agent (Claude Code, Codex, Cursor, VS Code):

```text
Set up an automatic AI code review for this repo, in the format kj reads.

Create a GitHub Actions workflow that, on each push to a pull request, runs an AI review of the PR's diff with this repo's own AI provider secret, and posts or updates ONE sticky comment as github-actions[bot] in exactly this format:

- First line: <!-- codex-review-lifecycle:v1 -->
- Exactly one line: **Recommendation: APPROVE** or **Recommendation: REQUEST_CHANGES**
- Last line, exactly once: <!-- codex-state:BASE64 --> where BASE64 is the base64 of a JSON object with the strings status, reviewed.head, reviewed.base and observedHead, and the array findings. Each finding has id, severity (CRITICAL, MAJOR or MINOR), status (active, fixed or dismissed), path and line. A dismissed finding also has dismissal.by.

Rules for the workflow:
- Review again on every new head: reviewed.head and observedHead are the PR's head sha.
- When a finding of an earlier review is gone, mark it fixed. Keep the ids stable.
- Treat every security finding as CRITICAL.
- Recommend APPROVE only when no finding is active.
- Never run the workflow on code from forks with secrets: use pull_request on same-repo branches only, and skip forks.
- The comment must not quote text that could contain the markers.

Then declare it in .karajan/kj.config.yml with review: { automatic: codex-state } and tell me to run kj harden, so the CI check waits for the bot.
```

The agent writes the workflow and the config line. You run `kj harden` and the seal yourself.
