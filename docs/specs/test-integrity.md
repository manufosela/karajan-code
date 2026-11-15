# Test integrity: an agent may not change a test to make its own code pass

Status: draft for the maintainer. It touches the Sentinel and `kj review`, which are governance code, so the design needs the maintainer's decision before the code (see "Decisions still the owner's").

## Objective

A change is trustworthy when its tests were written to describe the behaviour and the code was written to meet them. One sequence breaks that: the agent writes a test, writes the code, the test fails, and the agent edits the expected value of the test until it passes. Today nothing detects it mechanically. The red-before check only looks at new tests, mutation measures whether a test reacts to the code (not whether its expected value is right), and the Sentinel only asks that some test was touched.

Success: once a lane has edited source code, changing or deleting an assertion of a test that already existed in the lane is not possible without a recorded reason, the reason travels with the pull request, and the record can be audited afterwards.

Out of scope: judging whether a test is good, mutation testing (it exists), and agents that avoid every hook on purpose (this is a signal, not proof; see "Limits").

## The rule

In a lane, after the first edit of a source file, the assertions of a test file that existed at that moment are frozen. Adding tests and adding assertions stays free. Changing, weakening or deleting a frozen assertion, or marking a frozen test `skip`, `todo` or `only`, is refused until a reason is registered with `kj test-change --reason "<why the expected behaviour changed>"`.

The unit that freezes is the line, not the assertion. Reading assertions out of JavaScript text with regular expressions kept leaving holes (commas inside strings, parentheses inside regex literals), each one a way to change an expected value unseen; and the Sentinel's scripts are copied byte for byte into `.karajan/harness` and run alone, so they cannot depend on a parser package. A line diff has none of those holes: it never tries to understand the code. Each line is normalised by whitespace only (runs collapsed, ends trimmed, blank lines ignored). A pure reformat that moves line breaks shows as changed lines, which is an accepted false positive: the reason command is the way out.

The reference is the lane's state at its first source edit, not the state at the start of a `kj code` round. A test written by an earlier round of the coder is therefore frozen by the next round.

## Slices (each one pull request of about 150 net lines, test first)

1. **Frozen lines of a file.** A pure module `src/harden/sentinel/sentinel-test-integrity.mjs`: `linesOf(text)` returns the normalised, non-blank lines of a test file; `compareLines(before, after)` aligns the two lists (longest common subsequence) and returns the `added`, `changed` and `removed` lines, with their line numbers. `changed` is a removed line paired in order with an added one in the same gap. No I/O, no hooks. Tests: a pure insertion gives only `added`, a deletion only `removed`, an edited expected value one `changed` (also when it holds a comma inside a string or a regex literal with parentheses), whitespace-only edits give nothing, and an unchanged or empty file gives nothing.
2. **Freeze and refuse.** The PostToolUse hook records, on the first source edit of a lane, a snapshot of the assertions of every test file that exists (in `.karajan/harness`, with the Sentinel state). The PreToolUse hook compares an edit to a frozen test file with its snapshot and refuses a change to a frozen assertion with a message that names the registered-reason command. New command `kj test-change --reason` writes the reason, the file and the time into the lane's record. Fails open on anything unreadable, like the handoff reminder.
3. **Into the review and the PR.** `kj review --staged` adds a section to the reviewer's prompt listing the frozen assertions the diff changed, each with its reason, and asks the reviewer to confirm the old behaviour was wrong. The PR body generator prints the same list. Tests: the section appears only when something changed; reasons are shown, bodies of messages never.
4. **A record that can be audited.** The activity trace (`.karajan/traces/agent-activity.jsonl`) gets a hash chain: each line carries the hash of the previous one, so removing or editing a line is visible. New `kj audit --tests` walks the trace of a lane and reports: a frozen assertion changed with no reason, generic or repeated reasons, a lane with many test edits and few source edits, and time gaps with no recorded activity. Tests: a chain that was cut, a clean chain, each finding.

Slices 1 and 2 give the rule. Slice 3 gives the other AI the question to answer. Slice 4 gives the audit.

## Conditions for the audit to mean something

1. The agent must not be able to edit the record. The trace lives in the lane's `.karajan/`; the design must check whether the Sentinel already refuses an agent write there and, if not, refuse it (slice 4 includes the check).
2. The record must not have holes. Only what passes the hooks is seen. Before anyone trusts the absence of a record, measure what the hooks do not see: edits from a subprocess, a script, or the coder launched by `kj code`. Slice 4 reports the share of edits seen by the hooks against the changes in `git diff`.
3. The summary must travel with the pull request, so the maintainer and the reviewer see it and it stays on GitHub (slice 3).

## Limits

An agent set on cheating can avoid the hooks. The defence is the combination: this rule, the record, the review by a different AI, the red-before check and mutation. A flagged lane is a reason to look, not a verdict.

## Commands

Test: `npx vitest run tests/harden/sentinel-test-integrity.test.js` (and the files of each slice). Size: `kj pr-size`. Review: `kj review --staged` before each commit.

## Decisions still the owner's

- Whether the rule refuses (slice 2) or only flags: refusing can block a test that is really wrong, and the reason command is the way out.
- Whether `kj test-change` needs the human (a signature) or the agent may register a reason alone. Recommendation: the agent may register it, and the reason goes to the review.
- Where the record lives so the agent cannot edit it, if the Sentinel does not already guarantee it.
- Whether the same rule covers the coder that `kj code` launches as a subprocess (it must be checked that its edits pass the hooks) or needs its own check in `kj code`.
- An ADR for the hash chain, since it changes the trace format.

## Resumen en español

Una vez editado código fuente en una lane, no se pueden cambiar ni borrar las aserciones de un test que ya existía, salvo con una razón registrada (`kj test-change --reason`). Cuatro cambios pequeños: aserciones de un fichero, congelar y rechazar, pasar la lista al revisor y a la PR, y un registro con cadena de hashes que se puede auditar (`kj audit --tests`). Es una señal, no una prueba: la defensa es la combinación con la revisión de otra IA, el fallo demostrado y la mutación.
