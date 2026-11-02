# atril derived plugins and the user-level side effects of claude plugin install

Status: proposed
Date: 2026-11-02

## Context

A derived plugin (P11) is installed through the host CLI (claude/agy plugin install). That command writes at user level (~/.claude/plugins) even when atril installs at project scope. Issue #2430, step 13f.

## Decision

PROPOSED, needs the user: decide whether atril may run claude plugin install at all, with what scope and confirmation, and how remove undoes it. Default until decided: atril refuses and lists the command for the user to run.

## Consequences

Keeps a project install from silently changing the user machine. Derived plugins stay manual until accepted.
