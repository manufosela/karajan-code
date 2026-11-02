---
description: "Run any atril skill, command or agent: /atril <name or task>"
targets: ["*"]
---
<!-- atril:managed -->
Run `atril route --json "$ARGUMENTS"` and follow the plan it prints:
read each block's `content` when it has one, else its file, in order and
apply it to the task; run an entry of kind "subagent" as a subagent.
If the route is empty, say so.
Translate "$ARGUMENTS" into English before running it: atril's index is in English.
