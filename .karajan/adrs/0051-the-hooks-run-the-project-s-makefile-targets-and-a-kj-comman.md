# The hooks run the project's Makefile targets, and a kj command pins a step's command

Status: proposed
Date: 2026-11-10

## Context

Issue 3763: a Laravel repo runs PHP inside Docker through make lint, make analyse and make test; kj harden generated host commands (composer run ...) and overwrote the team's hand edits on every run, so the only safe advice was not to run kj harden there.

## Decision

Per hook step the command is, in order: one the project pinned with a kj command (stored in its kj.config.yml, never edited by hand), else the matching target of the root Makefile (lint plus analyse or analyze for the lint step, test, format-check), else the command detected for the stack. The maintainer chose this on 2026-11-10 over a config-only option.

## Consequences

A Makefile target now beats the detected command, also in JS repos that have one. Commands, pinned or detected, are part of the sealed generation, so the human sees them when sealing. Hooks owned by the project stay a separate decision.
