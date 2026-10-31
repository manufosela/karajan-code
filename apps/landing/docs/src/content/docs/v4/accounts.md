---
title: Several claude, codex and gh accounts
description: Personal and work subscriptions side by side; Karajan uses the account your session selects.
---

You may hold two subscriptions of the same CLI, for example a personal one and a work one. Karajan does not need its own setting for that. Each CLI already has a variable that chooses which account it uses, and Karajan follows it:

| CLI | Variable | Default |
|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` | `~/.claude.json` and `~/.claude` |
| Codex | `CODEX_HOME` | `~/.codex` |
| GitHub CLI | `GH_CONFIG_DIR` | `~/.config/gh` |

Whatever runs inside a session inherits those variables: `kj review`, the git hooks, the Sentinel, the MCP server and `kj code`. The cross-AI reviewer then works with the codex account of that session, and kj looks for each CLI's login and config in the same place.

## Set up a second account

The names below are only an example (`work`); use any name you like.

1. Pick one folder per account, for example `~/.claude-work`, `~/.codex-work` and `~/.config/gh-work`.
2. Start the work session with the three variables. An alias in your shell profile does it:

   ```sh
   alias claude-work='CLAUDE_CONFIG_DIR=$HOME/.claude-work CODEX_HOME=$HOME/.codex-work GH_CONFIG_DIR=$HOME/.config/gh-work claude'
   alias codex-work='CODEX_HOME=$HOME/.codex-work codex'
   ```

3. For `gh`, make a small command instead of an alias, so it also works in the non-interactive shells agents run commands in. Save it as `~/.local/bin/gh-work` and make it executable (`chmod 755`):

   ```sh
   #!/usr/bin/env sh
   GH_CONFIG_DIR="$HOME/.config/gh-work" exec gh "$@"
   ```

4. Log codex and gh in once with the work account:

   ```sh
   CODEX_HOME=$HOME/.codex-work codex login
   gh-work auth login
   ```

5. Open a new terminal (so the alias exists) and start `claude-work` in the work project.

With one gh config per account there is no shared "active account": `gh auth switch` is no longer needed, and no session can switch the account another one is using. Keep only the personal account in the default `~/.config/gh`.

Sessions started with plain `claude` keep using the default accounts. Sessions that were already open keep the variables they started with, so restart them after changing the alias.

## Check which account reviews

When the variable moves the account, `kj review --staged` names it on the reviewer line:

```text
kj review: host=claude → reviewer=codex (cross-AI) [CODEX_HOME=/home/you/.codex-work]
```

With the default account the bracket does not appear. `kj doctor` also checks the codex config of the selected account (`$CODEX_HOME/config.toml`).

## The GitHub account kj uses

When several `gh` accounts share one config, the active one is shared by every session, and another session can switch it while kj is running. So kj does not use it (one config per account, as above, avoids the problem altogether): at startup it takes the token of the repo's account (`gh auth token --user <account>`) and every `gh` it runs uses that one. The account is the owner of the `origin` remote (`git@github.com:you/repo.git` → `you`), provided `gh` has it logged in. For a repo owned by an organization, name the account in `.karajan/kj.config.yml`:

```yaml
review:
  github_account: you-work
```

A `GH_TOKEN` or `GITHUB_TOKEN` already set (CI, for instance) is always respected. If the configured account is not logged in to `gh`, kj warns and uses the active one.

## Good to know

- A long-running process keeps the account of the session that started it. If you start `kj board start` from a personal session, whatever the board launches uses the personal accounts.
- The second codex account starts with codex's defaults: no model, MCP servers or trusted projects from the first one. `kj review` does not need any of them.
- The same works without aliases: export both variables in your shell profile, in a `.envrc`, or in your terminal's profile for that project.
