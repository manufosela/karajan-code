---
title: Quality before the review
description: The deterministic checks that run before any model gives its opinion. Tests, weakened tests, mutation and Sonar. What they are, why they exist, when they act, how you use them and what they do not do.
---

## What it is

Before the reviewer reads a diff, `kj review` runs a set of checks that need no model. They answer questions with a fixed answer: do the diff's tests pass? Did a test lose an assertion? Did Sonar find something serious in the new lines? If one of them fails, the diff is rejected and the reviewer is not even called.

## Why it exists

A model's opinion costs tokens and can be wrong. Whether a test is red or not is not an opinion. So the facts come first, each one cheap and repeatable, and the model is asked only about what a fact cannot settle: whether the code is right.

There is also a limit kj is honest about: it cannot check that you wrote the test *before* the code (the order of TDD leaves no trace in a diff). What it can check is what that order is meant to produce: code that comes with tests, tests that pass, and tests that were not weakened to make them pass.

## When it acts

In `kj review --staged`, in this order. The first one that rejects ends the review:

| Check | What it does | By default |
|---|---|---|
| **Tests with the code** | Code changed without changing any test. A diff that only deletes lines or only touches comments is exempt. | Warns. Blocks with `method_gates.tests_with_code: block`. |
| **Sonar** | Scans the files the diff leaves alive. A BLOCKER or CRITICAL issue on a line the diff adds rejects; the rest is advice. | On (SonarQube in Docker). |
| **Sonar is required** | A diff that touches code is rejected if Sonar did not run or did not cover its files. A docs-only diff passes. | Always, for code. |
| **Mutation** | Mutates the changed code and looks for mutants the tests let survive (weak assertions). | Off. `method_gates.mutation: warn` or `block`. |
| **The diff's own tests** | Runs the test files the diff touches (vitest, jest or pytest). Red rejects without calling the model. | Always. |

Then the reviewer reads the diff, with the facts kj computed on it. One of them is **the weakened test**: an assertion removed from a test that already existed.

- If the assertion appears again in another test of the diff, it was moved: nothing to say.
- If a new assertion on the same thing replaces it in that file, it was rewritten: the reviewer is told, to judge it.
- If neither, the test was weakened: the reviewer is told. And when `kj code` wrote the change, its run fails, because the coder weakened an existing test.

## How you use it

You do not run these checks one by one: `kj review --staged` runs them. What you do:

- Keep SonarQube running (by default kj expects it at `localhost:9000`; `kj sonar start` starts its container). Without it, code does not pass the review.
- If Sonar really cannot run for a while, you, not the agent, grant a dated exception from your terminal: `kj policy grant --rule method.sonar.code --until <date> --reason "<why>"`. There is no environment variable that skips it.
- Decide whether tests-with-code warns or blocks, and whether you want mutation, in `method_gates`.
- Run `kj mutate --since <base>` yourself when you want to see the surviving mutants before the review.
- For changes that touch auth, user input, secrets, network or dependencies, run `kj audit --security` first. It uses no model (prompt injection, OSV, Semgrep, Sonar) and renews the security marker the [Steward](/docs/pieces/steward/) checks.

## What it does not do

- **It does not judge the design.** Green checks say the code runs and nothing obvious is wrong, not that it is the right code. That is the [cross review](/docs/pieces/cross-review/).
- **It does not check the order of TDD.** It checks the result: tests come with the code and still assert what they asserted.
- **It does not look at old code.** Sonar rejects for issues on the lines the diff adds; issues on lines it did not touch are reported as the file's trend.
- **It does not run your whole suite.** Only the diff's own test files. The full suite runs in the CI.
