# Karajan follows each repo's CONTRIBUTING.md

Status: accepted
Date: 2026-11-17

## Context

Asked by the maintainer on 2026-11-17: Karajan must be ruled by the CONTRIBUTING.md of each repo when it has one. kj rules compile read CLAUDE.md, AGENTS.md, the global CLAUDE.md and the feedback memories, not CONTRIBUTING.md.

## Decision

Decided by the maintainer on 2026-11-17: the CONTRIBUTING.md GitHub shows (.github/, then the root, then docs/) is a source of kj rules compile. Its rules are compiled into gates the maintainer approves with kj rules approve, and kj rules coverage names the ones still without a gate. The playbook kj writes in AGENTS.md tells the agent that CONTRIBUTING.md binds it as that file does.

## Consequences

A rule of CONTRIBUTING.md is enforced once it is compiled and approved, not before: no hard block while rules wait for approval. A repo with a long CONTRIBUTING.md adds rules to the coverage report.
