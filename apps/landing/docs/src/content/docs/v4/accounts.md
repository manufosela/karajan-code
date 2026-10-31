---
title: Several claude and codex accounts
description: Personal and work subscriptions side by side; Karajan uses the account your session selects.
---

You may hold two subscriptions of the same CLI, for example a personal one and a work one. Karajan does not need its own setting for that. Each CLI already has a variable that chooses which account it uses, and Karajan follows it:

| CLI | Variable | Default |
|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` | `~/.claude.json` and `~/.claude` |
| Codex | `CODEX_HOME` | `~/.codex` |

Whatever runs inside a session inherits those variables: `kj review`, the git hooks, the Sentinel, the MCP server and `kj code`. The cross-AI reviewer then works with the codex account of that session, and kj looks for each CLI's login and config in the same place.

## Set up a second account

The names below are only an example (`work`); use any name you like.

1. Pick one folder per account, for example `~/.claude-work` and `~/.codex-work`.
2. Start the work session with both variables. An alias in your shell profile does it:

   ```sh
   alias claude-work='CLAUDE_CONFIG_DIR=$HOME/.claude-work CODEX_HOME=$HOME/.codex-work claude'
   alias codex-work='CODEX_HOME=$HOME/.codex-work codex'
   ```

3. Log codex in once with the work account:

   ```sh
   CODEX_HOME=$HOME/.codex-work codex login
   ```

4. Open a new terminal (so the alias exists) and start `claude-work` in the work project.

Sessions started with plain `claude` keep using the default accounts. Sessions that were already open keep the variables they started with, so restart them after changing the alias.

## Check which account reviews

When the variable moves the account, `kj review --staged` names it on the reviewer line:

```text
kj review: host=claude → reviewer=codex (cross-AI) [CODEX_HOME=/home/you/.codex-work]
```

With the default account the bracket does not appear. `kj doctor` also checks the codex config of the selected account (`$CODEX_HOME/config.toml`).

## Good to know

- A long-running process keeps the account of the session that started it. If you start `kj board start` from a personal session, whatever the board launches uses the personal accounts.
- The second codex account starts with codex's defaults: no model, MCP servers or trusted projects from the first one. `kj review` does not need any of them.
- The same works without aliases: export both variables in your shell profile, in a `.envrc`, or in your terminal's profile for that project.
