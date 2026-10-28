---
name: using-atril
kind: skill
description: Use atril to find which skill, command or agent fits a task and load its instructions on demand. Reach for it before work that might already have a skill, or to find a skill.
---
# Using atril

atril keeps skills, commands and agents in a store and hands you only the ones a task needs.
Reach for it before starting a task that might already have a skill, command or agent for it.

## Route a task

`atril route "<task>" --role <role>` returns a block of artifacts. Read the files of that block,
and only those, in the order given.

## Search

`atril search "<words>" --json` lists ranked hits. A hit with `installed: false` (or an
`available` line in `atril route` output) is not in the store yet: run `atril install kind:name`
first, then read it.

## Rules

- Never load a whole store. Load what route or search returned.
- Never copy an artifact into the CLI's auto-loaded folders by hand: `atril expose kind:name`
  does it, and `atril unexpose kind:name` undoes it.
- With the MCP server (`atril mcp`) the same operations exist as tools.
