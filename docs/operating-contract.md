# kj's operating contract

This document is the contract of how kj works. It exists because the same kind of bug kept coming back from different users, each time from an assumption that nobody had written down. The maintainer decides these assumptions one at a time, and each decision goes here.

The rule above all of them: an issue that asks for the opposite of a decision in this contract is closed citing the contract, with no code.

Each decision names the code that enforces it and the test that proves it, so the contract is never only words.

## Decision 1: working with people who do not use kj

Decided on 2026-11-21.

- Using kj or not is each person's choice. The repo's rules bind everyone, and CI enforces them.
- The cross-AI review is mandatory for everyone, and it is bound to the last commit of the PR.
  - With kj: `kj review --staged` before each commit and `kj review --publish-pr` for the PR.
  - Without kj: an automatic AI review on the PR, written by a bot that kj verifies by its login.
  - A manual review or a plain GitHub "Approve" does not count.
- kj accepts only automatic reviews in a format it can read. Today that format is `codex-state`. Each repo declares it in `.karajan/kj.config.yml` (`review: { automatic: codex-state }`); `kj harden` writes it into the `kj-verdicts.yml` workflow, which enters sealed.
- Findings: none may be active.
  - CRITICAL and MAJOR findings can never be dismissed.
  - A MINOR finding can be dismissed only by someone other than the PR author who has write access.
  - A finding the bot files under security must be CRITICAL. kj cannot check this: in the codex-state format each finding's `category` is free text, and in practice it repeats the severity, so nothing marks a finding as security. kj takes the severity the bot gives (CRITICAL, MAJOR or MINOR).
- A PR that changes `.github/workflows/` never counts with the automatic review.

Where it lives:

- `src/review/codex-state.js`: reads the bot's comment strictly and fails closed.
- `src/review/automatic-review.js`: judges the automatic review of a PR.
- `src/review/verify-pr.js`: the CI check, with `--automatic-review` and `--wait-automatic`.
- `src/harden/workflow-templates.js`: the `kj-verdicts.yml` workflow that `kj harden` seeds.
- The guide `apps/landing/docs/src/content/docs/guides/working-without-kj.md`.
- Tests: `tests/review/codex-state.test.js`, `tests/review/automatic-review.test.js`, `tests/review/verify-pr-automatic-review.test.js` and `tests/review/verify-pr-wait-automatic.test.js`.

## Also decided: one local config for every lane

Decided on 2026-11-21 (HU-4757).

The operator's local config (`.karajan/kj.config.yml` and `rules.local.yml`) is one. Where git ignores it, every lane links it to the main checkout's copy, so there is no per-lane config. A tracked one belongs to the branch.

Where it lives: `src/hu/lane-setup.js`, with its tests in `tests/hu/lane-setup.test.js`.

## Decisions 2 to 7

Pending, decided one at a time.
