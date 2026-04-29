# Hardening Your Dev Environment Against AI Tools

When you delegate work to AI coding tools (Claude Code, Codex, Aider, Cursor, Gemini CLI, etc.), they run with **your full user privileges**. They can read, write, delete, push, force-push, and call any external API your shell can reach. This is by design — you want them to actually do work — but it means you need a defense strategy that does **not** rely on the AI behaving correctly.

This guide is **AI-agnostic and tool-agnostic**. It applies whether you use Karajan, raw Claude Code, raw Codex, or anything else. It works against current and future AI CLI tools alike.

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

---

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

---

## Layer 2 — Prevention: a separate restricted Linux user

This is the **strongest layer**. Create a dedicated user (e.g., `ia-user`) for running AI tools. The kernel itself enforces what the user can read and write.

**Why it works**: an AI running as `ia-user` cannot escape the UID. No `find -delete`, no Python script, no exotic syscall can bypass it. The kernel returns `EACCES` before the AI even attempts the operation.

**Setup**:

```bash
# 1. Create user
sudo useradd -m -s /bin/bash ia-user
sudo passwd ia-user

# 2. Allow ia-user to traverse your home and read project dirs
setfacl -m u:ia-user:--x /home/$USER                       # traverse home
setfacl -R -m u:ia-user:r-X /home/$USER/projects           # read projects
setfacl -dR -m u:ia-user:r-X /home/$USER/projects          # inherit on new files

# 3. Generate a separate SSH key for ia-user, register it on GitHub
sudo -u ia-user ssh-keygen -t ed25519 \
  -f /home/ia-user/.ssh/id_ed25519 -N ""
gh ssh-key add /home/ia-user/.ssh/id_ed25519.pub \
  --title "ia-user@$(hostname)"

# 4. Make claude (or any other CLI) discoverable
sudo ln -s "$(which claude)" /usr/local/bin/claude
```

**Per-project workflow**: grant write only when actively working on a project, revoke after.

```bash
# Helper: grant write
setfacl -R -m u:ia-user:rwX ~/projects/active-project
setfacl -dR -m u:ia-user:rwX ~/projects/active-project

# Run AI tools as ia-user
sudo -i -u ia-user
cd /home/$YOUR_USER/projects/active-project
claude   # or codex, gemini, aider...
```

The result: an AI running as `ia-user` reads your code freely but writes only to the project you've explicitly granted. Everything else returns `Permission Denied` at the kernel level.

**One restricted user serves all AI CLIs.** Claude Code, Codex, Aider, Gemini CLI, Cursor (when launched from terminal) — they all run under the same UID and inherit the same restrictions. One configuration protects the whole ecosystem.

---

## Layer 3 — Immutability for critical files

For files that must never change (SSH keys, identity configs), use the immutable filesystem flag:

```bash
sudo chattr +i ~/.ssh/id_ed25519
sudo chattr +i ~/.ssh/id_ed25519.pub
sudo chattr +i ~/.ssh/config
```

Once set, even `sudo rm -rf` cannot remove the file. To modify or delete legitimately, remove the flag first with `sudo chattr -i <file>`.

Verify with `lsattr`:

```bash
lsattr ~/.ssh/id_ed25519
# ----i---------e----- /home/you/.ssh/id_ed25519
```

The `i` in the 5th position means immutable.

---

## Layer 4 — Server-side protection on Git hosts

The remote should enforce its own rules independent of your local environment.

### Branch protection rulesets (GitHub)

Block force-push and deletion of `main` on every personal repo:

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

Loop over `gh repo list <user> --limit 1000 --json nameWithOwner` to apply this everywhere.

### Token scopes

Don't grant `delete_repo` to your default GitHub token. Without that scope, no AI can delete your repos via the GitHub API even if it tries:

```bash
gh auth status   # verify scopes; ensure delete_repo is NOT listed
```

If it appears, refresh without that scope:

```bash
gh auth refresh -h github.com -s repo,workflow,gist
```

---

## Layer 5 — Tool-specific deny rules

This is the **weakest layer** (it's the whack-a-mole one) but useful for catching obvious mistakes — yours or the AI's.

Example for Claude Code in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf*)",
      "Bash(rm -fr*)",
      "Bash(rm -Rf*)",
      "Bash(rm -fR*)",
      "Bash(git push --force*)",
      "Bash(git push -f*)",
      "Bash(git push --delete*)",
      "Bash(git reset --hard*)",
      "Bash(git branch -D*)",
      "Bash(git clean -f*)",
      "Bash(git checkout --orphan*)",
      "Bash(gh repo delete*)",
      "Bash(gh release delete*)",
      "Bash(gh api -X DELETE*)",
      "Bash(gh api --method DELETE*)"
    ]
  }
}
```

Other AI CLIs have similar mechanisms (Codex's `~/.codex/config.toml`, Aider's confirmation flags). Use them as reinforcement, not as primary defense.

---

## Layer 6 — Pre-commit hooks against AI attribution

If your policy is "no AI references in commits/PRs", enforce it locally **and** server-side:

- **Local**: pre-commit / commit-msg hook that blocks patterns like `Co-Authored-By: Claude`, `generated by AI`, etc.
- **Server-side**: GitHub Action that checks PR body, issue body, commit messages, and review comments for the same patterns.

Reference implementation: [`@geniova/git-hooks`](https://github.com/geniova-tech/git-hooks).

---

## Recommended layer combination

The minimum effective combination:

| Layer | Effort | Effectiveness |
|---|---|---|
| Backups (Borg) | Low (one-time) | High — recovery |
| Restricted user (`ia-user`) | Medium (one-time) | **Very high** — kernel-enforced prevention |
| `chattr +i` on SSH keys | Trivial | High for those files |
| Branch protection on GitHub | Trivial (script) | High — server-side |
| GitHub token without `delete_repo` | Trivial | High |

Optional reinforcements:

- Tool-specific deny rules
- Pre-commit hooks against AI attribution
- Filesystem snapshots (Timeshift, BTRFS/ZFS)

---

## Common objections

**"This is too much friction."**
Run AI as `ia-user` only when delegating real work. For exploration and quick chats, your normal user is fine. The friction is one `sudo -i -u ia-user` per session.

**"My AI is trustworthy."**
Maybe today. The defense doesn't depend on the current AI. It defends against future model updates, prompt injection in untrusted input, MCP servers you've never audited, and your own typos at 2am.

**"I use Docker / a container."**
Containers are a great Layer 2 alternative, especially if you already run dev environments containerized. The principle is identical: kernel-enforced isolation, not denylist policing.

---

## Summary

> You can't prohibit what you haven't imagined. But you can deny access to what shouldn't be touched.

Layered defense, with the strong layers (kernel-enforced isolation + reliable backups) doing the real work. Everything else is narrow adjustments.

This applies whether you're using Karajan to orchestrate multiple agents, running a single AI assistant, or any combination. The defenses are at the OS and Git-host level — not at the AI's level — which is exactly why they work.
