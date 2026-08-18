---
title: Template — Command page
description: Internal scaffold used when adding a new command to the Handbook. Not published to the sidebar.
sidebar:
  hidden: true
---

> This is the canonical structure used by every page under `handbook/commands/`. Copy this file, rename it to the command name (e.g. `run.mdx`), and fill in the sections in order. The structure is fixed — if a section doesn't apply, write "Not applicable" and explain why in one line, rather than removing the heading. Consistency lets readers scan the handbook with the same mental model on every page.

---
title: kj <command>
description: <one-line summary>
---

## What it does

A 2-4 paragraph description of the command's behaviour. Plain prose, no flag tables — those come below. Cover:

- The high-level intent (what problem does this command solve?).
- The phases it goes through (e.g. "first it does X, then Y, then Z").
- The output the user can expect (files written, console output, exit codes).
- Where it sits in the broader workflow.

This section should let a reader who's never seen the command understand what it does without running it.

## When to use

Bullet list of concrete scenarios where this command is the right tool. Each item:

- **Scenario name** — one-line example: `kj <command> <args>`.

Aim for 3-6 scenarios. They should be specific (not "for code quality" but "after refactoring a critical module to verify the rewrite kept call-sites compiling").

## When NOT to use

Bullet list of scenarios where this command is overhead, noise, or the wrong tool. Each item with the reason:

- **Scenario** — why it doesn't fit. What to do instead (link to the right command).

Aim for 2-5 scenarios. The handbook's job is to prevent waste; this section is half its value.

## Options

Table of every flag.

| Flag | Default | When to flip it | Interaction |
| --- | --- | --- | --- |
| `--example` | `false` | "When you need X" — concrete example. | Mutually exclusive with `--other-flag` / requires `--prereq`. |

For each flag, the "When to flip it" cell carries the reasoning that's missing from the bare reference. The "Interaction" column is only filled when the flag has non-obvious interplay with another flag or config field.

If the command has subcommands, give each subcommand its own H3 with the same Options table.

## Examples

3-5 representative recipes, each with explanation. Format:

### <name of scenario>

```bash
kj <command> <flags> "<args>"
```

What happens: 2-3 sentences explaining the output, the side effects, and what to look at next.

Cover at least:
- **Typical** — the most common interactive use.
- **CI/automation** — non-interactive (`--yes`), JSON output if available, exit-code-aware.
- **Advanced** — the power-user shape (`--only <subset>`, custom config, edge case).

## How it works internally

2-3 paragraphs explaining the "why behind the why". Not code — reasoning. Cover:

- The internal pipeline / modules involved (at a conceptual level, not file paths).
- Key design decisions and the trade-offs they encode.
- Anything counter-intuitive a reader might wonder about.

Don't repeat the "What it does" section. This is for readers who already understood the surface behaviour and want to know why it's shaped that way.

## Related

- [`kj <other>`](./other) — when to use this instead of `<command>`.
- [Pipeline roles → `<role>`](../pipeline-roles#<role>) — the role that powers this command (if applicable).
- [`<concept>` in the configuration reference](../../reference/configuration/#<anchor>).
