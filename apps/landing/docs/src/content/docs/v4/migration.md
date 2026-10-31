---
title: Migrating to 5.0
description: Karajan 5.0 retires the kj run pipeline. What replaces each retired command.
---

Karajan Code 5.0 retires the pipeline that ran `kj run`. That pipeline was Karajan acting as the agent: it spawned a coder, a reviewer and a judge as subprocesses and drove them through a loop. Since v4 your own agent (Claude Code, Codex, OpenCode, Gemini...) does the work, and Karajan governs it: what has to be true before a commit, a merge or a release, enforced by git gates and the Sentinel.

```bash
npm install -g karajan-code@5
```

If you already work the v4 way (your agent, `kj review --staged`, `kj hu`, `kj worktree`), nothing changes for you. A retired command still answers: it exits 1 without starting anything and says what replaced it. To keep the pipeline a while longer, stay on 4.x: `npm install -g karajan-code@4`.

## How the work is done now

What the pipeline did in one command, your agent now does step by step, inside the method:

1. **Plan.** The agent splits the task with the planner's brief (`kj brief planner`): steps of one commit, PRs of ~150 net lines. Each piece goes on the board: `kj hu add "<title>"`.
2. **Isolate.** One lane per card when you work in parallel: `kj worktree start <slug>`, and one agent session inside it.
3. **Write, test first.** The failing test comes first; the suite never stays red.
4. **Review by another AI.** `kj review --staged` before every commit. The verdict binds to the exact diff and the pre-commit gate checks it. Disagree with a rejection? `kj solomon`.
5. **Merge and close the lane.** A PR per card; after the merge, `kj worktree done <slug>`.
6. **Watch it.** `kj board start`: each card shows its lane, branch, commits ahead and PR, and the Governance view lists lanes outside the method.

## Retired commands

| Retired | Use instead |
|---|---|
| `kj run`, `kj autorun` | Your agent, following the steps above |
| `kj resume`, `kj standby` | Nothing to resume: your agent's session is the session |
| `kj plan generate` | `kj brief planner` for your agent, then `kj hu add` for each piece |
| `kj status` | `kj board start` |
| `kj undo` | git: every reviewed step is its own commit |
| `kj triage`, `kj researcher`, `kj architect` | `kj brief triage`, `kj brief researcher`, `kj brief architect`: your agent applies the role |
| `kj review "<task>"` (reviewer only) | `kj review --staged` (or `--range base..head`) |

`kj code` stays: when the coder declared in your panel is not the agent you talk to, `kj code --agent <coder> --card <ref>` has that coder write, and the Governance view records that the panel was honoured. The rest of `kj plan` (`list`, `show`, `validate`, `approve`) stays as it was.

## MCP tools

The MCP tools that drove the same pipeline (`kj_run`, `kj_resume`, `kj_status`, `kj_undo`, `kj_plan` and the single-role tools) are retired with their commands. A call answers with the same notice. Your agent works with the commands above instead.

## The board

The HU Board no longer launches runs: the **Run plan** button and the ▶ on each card are gone. Cards, lanes and the Governance view work as before.
