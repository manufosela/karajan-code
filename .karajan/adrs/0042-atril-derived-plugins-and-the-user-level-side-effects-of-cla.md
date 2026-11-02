# atril derived plugins and the user-level side effects of claude plugin install

Status: accepted
Date: 2026-11-02 (accepted 2026-11-02)

## Context

A derived plugin (P11) is installed through the host CLI (claude/agy plugin install). That command writes at user level (~/.claude/plugins) even when atril installs at project scope. Issue #2430, step 13f.

## Decision

Accepted by the maintainer: atril never runs `claude plugin install`, or the equivalent command of another CLI. It lists the command for the user to run. Derived plugins stay manual: atril lists them and shows the command, and installs nothing at user level. This is what the `native` mode of `pluginMode` already does.

## Consequences

A project install never changes the user machine. The user runs the command and owns its effect at user level. `atril remove` has nothing to undo for a derived plugin, because atril installed nothing. Letting atril run the command, with a scope, a confirmation and an undo, would need a new ADR.
