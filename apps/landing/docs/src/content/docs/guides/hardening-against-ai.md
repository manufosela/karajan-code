---
title: Hardening Against AI
description: Protect your dev environment from AI tools — works whether or not you use Karajan.
---

When you delegate work to AI coding tools (Claude Code, Codex, Aider, Cursor, Gemini CLI, etc.), they run with **your full user privileges**. They can read, write, delete, push, force-push, and call any external API your shell can reach. This is by design — you want them to actually do work — but it means you need a defense strategy that does **not** rely on the AI behaving correctly.

This guide is **AI-agnostic and tool-agnostic**. It applies whether you use Karajan, raw Claude Code, raw Codex, or anything else.

## The wrong mental model

> "I'll add `rm -rf` to my deny list."

This is whack-a-mole. For every dangerous command you block, the AI can find another:

| Blocked | Equivalent |
|---|---|
| `rm -rf` | `find -delete` |
| `find -delete` | `python -c "shutil.rmtree(...)"` |
| `python` | `node -e "fs.rmSync(...)"` |
| `node` | `perl -e "unlink ..."` |

You'd need to enumerate every shell command, every interpreter, every language's filesystem API. You can't.

## The right mental model

**Defense in depth, with layers that don't depend on enumerating bad behavior.** The strong layers are kernel-enforced and server-side; everything else is reinforcement.

## Layer 1 — Recovery: assume something will break

Take regular encrypted backups to a destination you control. The goal isn't "prevent damage" but "make recovery cheap and reliable".

**Recommended**: [BorgBackup](https://www.borgbackup.org/) to a local NAS, daily, with deduplication and AES encryption.

```bash
# Initialize repo
borg init --encryption=repokey-blake2 user@nas:/path/to/borg-repo

# Daily snapshot
export BORG_PASSCOMMAND="cat ~/.config/borg/passphrase"
borg create user@nas:/path/to/borg-repo::"$(date +%Y%m%dT%H%M%S)" \
  ~/projects \
  --exclude '**/node_modules' \
  --exclude '**/dist' \
  --exclude '**/.cache'

# Retention: 7 daily, 4 weekly, 6 monthly
borg prune user@nas:/path/to/borg-repo \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 6
```

If an AI deletes something you needed, recovery is one `borg extract` away.

## Layer 2 — Prevention: a separate restricted Linux user

This is the **strongest layer**. Create a dedicated user (e.g., `ia-user`) for running AI tools. The kernel itself enforces what the user can read and write.

**Why it works**: an AI running as `ia-user` cannot escape the UID. No `find -delete`, no Python script, no exotic syscall can bypass it. The kernel returns `EACCES` before the AI even attempts the operation.

```bash
# 1. Create user
sudo useradd -m -s /bin/bash ia-user
sudo passwd ia-user

# 2. Allow ia-user to traverse your home and read project dirs
setfacl -m u:ia-user:--x /home/$USER
setfacl -R -m u:ia-user:r-X /home/$USER/projects
setfacl -dR -m u:ia-user:r-X /home/$USER/projects

# 3. Generate a separate SSH key for ia-user, register it on GitHub
sudo -u ia-user ssh-keygen -t ed25519 \
  -f /home/ia-user/.ssh/id_ed25519 -N ""
gh ssh-key add /home/ia-user/.ssh/id_ed25519.pub \
  --title "ia-user@$(hostname)"

# 4. Make claude (or any other CLI) discoverable
sudo ln -s "$(which claude)" /usr/local/bin/claude
```

**Per-project workflow**: grant write only when actively working, revoke after.

```bash
# Grant write on a project
setfacl -R -m u:ia-user:rwX ~/projects/active-project
setfacl -dR -m u:ia-user:rwX ~/projects/active-project

# Run AI tools as ia-user
sudo -i -u ia-user
cd /home/$YOUR_USER/projects/active-project
claude   # or codex, gemini, aider...
```

**One restricted user serves all AI CLIs.** Claude Code, Codex, Aider, Gemini CLI, Cursor — they all run under the same UID and inherit the same restrictions. One configuration protects the whole ecosystem.

## Layer 3 — Immutability for critical files

For files that must never change (SSH keys, identity configs):

```bash
sudo chattr +i ~/.ssh/id_ed25519
sudo chattr +i ~/.ssh/id_ed25519.pub
sudo chattr +i ~/.ssh/config
```

Once set, even `sudo rm -rf` cannot remove the file. To modify legitimately, run `sudo chattr -i <file>` first.

## Layer 4 — Server-side protection on Git hosts

The remote should enforce its own rules independent of your local environment.

### Branch protection rulesets (GitHub)

Block force-push and deletion of `main` on every repo:

```bash
gh api -X POST repos/OWNER/REPO/rulesets --input - <<EOF
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["refs/heads/main", "refs/heads/master"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ],
  "bypass_actors": []
}
EOF
```

### Token scopes

Don't grant `delete_repo` to your default GitHub token. Without that scope, no AI can delete your repos via the API even if it tries.

```bash
gh auth status   # verify scopes; ensure delete_repo is NOT listed
```

## Layer 5 — Tool-specific deny rules

This is the **weakest layer** but useful for catching obvious mistakes.

Example for Claude Code (`~/.claude/settings.json`):

```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf*)",
      "Bash(rm -fr*)",
      "Bash(git push --force*)",
      "Bash(git push -f*)",
      "Bash(git reset --hard*)",
      "Bash(git branch -D*)",
      "Bash(gh repo delete*)",
      "Bash(gh api -X DELETE*)"
    ]
  }
}
```

## Layer 6 — Pre-commit hooks against AI attribution

If your policy is "no AI references in commits/PRs":

- **Local**: pre-commit / commit-msg hook blocking `Co-Authored-By: Claude`, `generated by AI`, etc.
- **Server-side**: GitHub Action that checks PR body, issue body, commit messages, and review comments.

Reference: [`@geniova/git-hooks`](https://github.com/geniova-tech/git-hooks).

## Recommended layer combination

| Layer | Effort | Effectiveness |
|---|---|---|
| Backups (Borg) | Low | High — recovery |
| Restricted user | Medium | **Very high** — kernel-enforced prevention |
| `chattr +i` on SSH keys | Trivial | High for those files |
| Branch protection | Trivial | High — server-side |
| Token without `delete_repo` | Trivial | High |

## Common objections

**"This is too much friction."** — Run AI as `ia-user` only for real delegation. For exploration, your normal user is fine. The friction is one `sudo -i -u ia-user` per session.

**"My AI is trustworthy."** — Maybe today. The defense protects against future model updates, prompt injection from untrusted input, unaudited MCP servers, and your own 2am typos.

**"I use Docker."** — Great Layer 2 alternative. Same principle: kernel-enforced isolation, not denylist policing.

## Summary

> You can't prohibit what you haven't imagined. But you can deny access to what shouldn't be touched.

The strong layers (kernel-enforced isolation + reliable backups) do the real work. Everything else is narrow adjustments. This applies whether you're orchestrating agents with Karajan, running a single AI assistant, or any combination — the defenses live at the OS and Git-host level, which is exactly why they work.

## Next: actual files to drop on disk

This page is the *why*. For the *how* — concrete config for git hooks, agent permissions (Claude / Codex / Gemini), and multi-account SSH — see [Recommended Setup](/guides/recommended-setup/).
