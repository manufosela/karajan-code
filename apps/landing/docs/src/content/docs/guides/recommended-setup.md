---
title: Recommended Setup
description: Concrete config for git hooks, agent permissions, multi-account SSH and branch protection — the practical companion to Hardening Against AI.
---

This guide is the **practical companion** to [Hardening Against AI](/guides/hardening-against-ai/). That guide explains *why* you need defense-in-depth when delegating to AI; this one gives you the *exact files to drop on disk* so you don't have to invent the config from scratch.

Everything here is **agent-agnostic**: SSH and git hooks are shared, then a section per agent (Claude Code, Codex, Gemini CLI) with the equivalent permission file. Pick the agents you actually use and skip the rest.

> The end of each section has a collapsible **"Real-world setup"** block with one maintainer's own config, lightly anonymized. Useful as a sanity check ("am I missing something obvious?") — not gospel.

## 1. GitHub multi-account via SSH

If you commit from more than one identity (personal vs work, or split AI bot vs human), don't keep switching `git config user.email` per repo. Use one SSH key per account and an alias per account in `~/.ssh/config`.

```sshconfig
# ~/.ssh/config

Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_personal
  IdentitiesOnly yes

Host github.com-personal
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_personal
  IdentitiesOnly yes

Host github.com-work
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_work
  IdentitiesOnly yes
```

Generate the keys with `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_<account> -C "<email>"` and register each `.pub` on the matching GitHub account.

Then clone with the alias:

```bash
git clone git@github.com-work:org/repo.git
git clone git@github.com-personal:me/side-project.git
```

`git push` automatically uses the right key because the remote URL pins the host alias. No more "Permission denied (publickey)" when you forget to switch accounts.

<details>
<summary>Real-world setup</summary>

```sshconfig
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_personal

Host github.com-manufosela
  IdentityFile ~/.ssh/id_ed25519_personal

Host github.com-company
  IdentityFile ~/.ssh/id_ed25519
```

Two separate keys, one default host (personal) plus aliases for both. Legacy remotes still using `github.com-manufosela:...` keep working without rewriting URLs.

</details>

## 2. Global git hooks via `core.hooksPath`

Don't install hooks repo-by-repo. Point git to one shared directory and every repo on your machine inherits the same gates.

```bash
mkdir -p ~/.git-hooks
git config --global core.hooksPath ~/.git-hooks
```

### `commit-msg` hook: block AI attribution

Drop this at `~/.git-hooks/commit-msg`, `chmod +x` it. Rejects commits whose message claims AI authorship — useful if your team's policy is "humans author commits, AI doesn't sign":

```bash
#!/usr/bin/env bash
COMMIT_MSG=$(cat "$1")

CO_AUTHOR='Co-[Aa]uthored-[Bb]y:.*\b(Claude|Anthropic|OpenAI|ChatGPT|GPT-[0-9]|Copilot|Gemini|Cursor|Windsurf|Codeium)\b'
ATTRIBUTION='(Generated|Created|Written|Authored|Assisted) (by|with|using|via) .*(Claude|Anthropic|OpenAI|ChatGPT|Copilot|Gemini|Cursor|Windsurf|Codeium)'
SIGNED_OFF='Signed-off-by:.*\b(Claude|Anthropic|OpenAI|ChatGPT|Copilot|Gemini|Cursor|Windsurf|Codeium)\b'

for pat in "$CO_AUTHOR" "$ATTRIBUTION" "$SIGNED_OFF"; do
  if echo "$COMMIT_MSG" | grep -qiE "$pat"; then
    echo "✗ Commit rejected: AI attribution detected." >&2
    echo "  Remove the offending line and try again." >&2
    echo "  Do NOT use --no-verify; this is a policy gate." >&2
    exit 1
  fi
done
```

### `pre-commit` hook: cheap correctness gates

A pre-commit hook should be **fast** (<2s) and **deterministic**. Lint and format the staged diff, not the whole tree:

```bash
#!/usr/bin/env bash
STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|mjs|ts|tsx|jsx)$' || true)
[ -z "$STAGED" ] && exit 0

npx eslint --no-warn-ignored $STAGED || exit 1
```

For per-repo gates (test suite, build, shrink-budget), prefer a CI workflow — pre-commit hooks that take 30 s lose their value the moment people start using `--no-verify`.

### `post-commit` hook: nudge, don't block

Useful for things like reminding you to push, run a quick smoke check, or refresh a local cache. Never put failing logic here — `post-commit` runs after the commit already exists, so it can't roll back.

```bash
#!/usr/bin/env bash
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "⚠  You just committed on $BRANCH directly. Prefer feature branches + PRs." >&2
fi
```

<details>
<summary>Real-world setup</summary>

One maintainer keeps **only the `commit-msg`** hook globally and lets per-project tooling (husky, lefthook, project-specific scripts) handle pre-commit. Reason: pre-commit needs project context (which package manager? which lint config?), but the AI-attribution policy is identical across every repo.

```bash
$ git config --global core.hooksPath
/home/me/.git-hooks
$ ls ~/.git-hooks
commit-msg
```

</details>

## 3. Server-side branch protection

Local hooks are a nudge; the only enforceable layer is on the remote. Protect `main` with a GitHub ruleset that blocks force-push and deletion, and requires a PR review.

See [Hardening Against AI → Layer 4](/guides/hardening-against-ai/#layer-4--server-side-protection-on-git-hosts) for the full `gh api rulesets` recipe. The minimum for any repo with AI delegation:

- Block force-push to `main`
- Block deletion of `main`
- Require at least one PR review (or status check) before merge
- Your default `gh` token does **not** carry the `delete_repo` scope

Verify your token scopes:

```bash
gh auth status
# Token scopes: 'gist', 'read:org', 'repo', 'workflow'
# (no delete_repo → good)
```

## 4. Per-agent permission policies

Every AI CLI ships a permissions / sandbox file. Drop the same set of denylist patterns into each so a single misclick doesn't go further than a confirmation prompt.

### 4a. Claude Code — `~/.claude/settings.json`

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "defaultMode": "auto",
    "allow": [
      "Bash(npm run lint)",
      "Bash(npm run test *)",
      "Bash(npm run build)",
      "Bash(git log *)",
      "Bash(git status *)",
      "Bash(git diff *)",
      "Bash(git fetch *)",
      "Bash(gh pr list *)",
      "Bash(gh pr view *)",
      "Bash(gh pr diff *)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Bash(rm -rf*)",
      "Bash(rm -fr*)",
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

The `allow` list short-circuits the confirmation prompt for read-only and routine commands. The `deny` list refuses outright — Claude can't bypass it even with explicit user consent in the session.

### 4b. Codex — `~/.codex/rules/default.rules`

Codex uses a flat rules file with `prefix_rule(pattern=[...], decision="allow|deny")`. Pin destructive patterns to `deny`:

```python
prefix_rule(pattern=["rm", "-rf"], decision="deny")
prefix_rule(pattern=["git", "push", "--force"], decision="deny")
prefix_rule(pattern=["git", "push", "-f"], decision="deny")
prefix_rule(pattern=["git", "reset", "--hard"], decision="deny")
prefix_rule(pattern=["gh", "repo", "delete"], decision="deny")

prefix_rule(pattern=["npm", "test"], decision="allow")
prefix_rule(pattern=["npx", "vitest", "run"], decision="allow")
prefix_rule(pattern=["git", "log"], decision="allow")
prefix_rule(pattern=["git", "status"], decision="allow")
prefix_rule(pattern=["gh", "pr", "view"], decision="allow")
```

In `~/.codex/config.toml`, pin sensitive directories to `trust_level = "untrusted"` so Codex prompts before touching them:

```toml
[projects."/home/me/secrets"]
trust_level = "untrusted"
```

### 4c. Gemini CLI — `~/.gemini/settings.json`

```json
{
  "security": {
    "auth": { "selectedType": "oauth-personal" }
  },
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}
```

Pair it with `~/.gemini/trustedFolders.json` to opt in folders explicitly — anything outside the list triggers a confirmation:

```json
{
  "trustedFolders": [
    "/home/me/projects/active-work"
  ]
}
```

Gemini CLI doesn't expose a denylist as rich as Claude's, so this layer leans on **filesystem trust** rather than command patterns. Combine with restricted-user isolation (next section) for real safety.

## 5. Restricted Linux user

The strongest layer is kernel-enforced: run AI tools as a dedicated `ia-user` with read-only ACLs by default and per-project writes when actively delegating.

See [Hardening Against AI → Layer 2](/guides/hardening-against-ai/#layer-2--prevention-a-separate-restricted-linux-user) for the full recipe. The TL;DR:

```bash
sudo useradd -m -s /bin/bash ia-user
setfacl -m u:ia-user:--x /home/$USER
setfacl -R -m u:ia-user:r-X /home/$USER/projects

# Grant write only when actively working
setfacl -R -m u:ia-user:rwX ~/projects/current

# Run any AI CLI as the restricted user
sudo -i -u ia-user
claude   # or codex, gemini, aider — same UID, same restrictions
```

One restricted user serves every AI CLI. The kernel returns `EACCES` before the agent can attempt the operation, no matter how creative its commands get.

## 6. Daily workflow

The point of all this is a workflow that survives mistakes:

1. **Branch per task.** `git checkout -b feat/TICKET-N-short-description`. Never commit on `main` — the post-commit hook in §2 warns you if you slip.
2. **Commit small.** Hooks lint the staged diff; small commits keep the gate fast.
3. **Push and PR.** `git push -u origin <branch>` then `gh pr create`. The remote ruleset (§3) refuses any direct push to `main`.
4. **Auto-review before human review.** If you use Claude Code's `code-review` plugin (`/code-review` slash command), run it on the PR diff before requesting review. Catches obvious smells in seconds.
5. **Squash-merge.** Keep `main` linear. Required status checks block the merge button until tests pass.

If you delegate any of steps 1-4 to an AI, do it as `ia-user` (§5). The branch-and-PR flow keeps mistakes scoped to a branch you can throw away.

## 7. Secret scanning before push

The `commit-msg` hook in §2 blocks AI attribution; the `pre-push` hook blocks something more dangerous — pushing credentials to a remote you don't control. Once secrets land on GitHub, rotation is the only safe response. Pre-push is your last chance to catch them locally.

### git-secrets (pattern-based)

[`git-secrets`](https://github.com/awslabs/git-secrets) ships AWS patterns by default and accepts custom regexes. Install it once and wire it into the global hooks dir:

```bash
# Build + install (one-shot)
git clone https://github.com/awslabs/git-secrets.git /tmp/git-secrets
sudo make -C /tmp/git-secrets install

# Register AWS patterns + install hooks globally
git secrets --register-aws --global
git secrets --install --global ~/.git-hooks

# Custom patterns: GitHub tokens, GCP keys, generic API keys
git secrets --add --global 'ghp_[A-Za-z0-9]{36}'
git secrets --add --global 'AIza[0-9A-Za-z\-_]{35}'
git secrets --add --global '(?i)(api[_-]?key|secret)[ \t=:"]+[A-Za-z0-9+/=_-]{20,}'
```

The tool installs three handlers: `pre-commit`, `commit-msg`, and `prepare-commit-msg`. A match returns exit 1 with the offending file + line so you can fix and retry. Allowlisting a false positive: `git secrets --add --allowed --global '<exact match>'`.

### `pre-push`: block direct push to protected branches

Branch protection on the server (§3) already refuses these pushes, but a local `pre-push` hook stops the request before it leaves the machine. Saves CI minutes and avoids the awkward "I tried, the remote refused" exchange:

```bash
#!/usr/bin/env bash
# ~/.git-hooks/pre-push
PROTECTED='^refs/heads/(main|master|production|release/.*)$'

while read local_ref local_sha remote_ref remote_sha; do
  if [[ "$remote_ref" =~ $PROTECTED ]]; then
    echo "✗ Direct push to $remote_ref refused. Open a PR instead." >&2
    echo "  Override with: git push --no-verify  (don't)." >&2
    exit 1
  fi
done
exit 0
```

`git-secrets` does NOT install a `pre-push` hook by default, so the two coexist without conflict. If you ever need to combine multiple `pre-push` checks, chain them with a wrapper script that exits on first non-zero.

<details>
<summary>Real-world setup</summary>

One maintainer keeps only the branch-check `pre-push` globally and runs `git-secrets` per-repo (via `npm run secrets:scan` in CI). Reason: pattern lists drift per project (a fintech repo has different secret shapes than a static site), and global patterns end up either too noisy or too lax.

</details>

## 8. GitHub repo templates

A PR with no description is a code review by guessing. Templates make collaboration honest by default.

### PR template

Drop this at `.github/PULL_REQUEST_TEMPLATE.md` in the root of each repo:

```markdown
## Summary

<!-- One or two sentences: what changed and why. -->

## Test plan

- [ ] Existing tests still pass
- [ ] New tests added for the change
- [ ] Tested manually on <browser/OS/version>
- [ ] No AI attribution in commits or PR body

## Checklist

- [ ] PR is atomic (single feature, fix, or refactor)
- [ ] Under ~200 LOC net (or `large-pr-justified` label with rationale)
- [ ] Linked ticket: <!-- e.g. PRJ-TSK-0042 -->
```

If your team uses Karajan Code's `code-review` plugin, the checklist above is what it grades against — keep them aligned.

### Issue templates (YAML form schema)

Structured fields force usable bug reports. `.github/ISSUE_TEMPLATE/bug.yml`:

```yaml
name: Bug report
description: Something broken, with a clean repro
labels: [bug]
body:
  - type: textarea
    id: repro
    attributes:
      label: Reproduction steps
      placeholder: |
        1. Run `...`
        2. Click on `...`
        3. Observe `...`
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Version
      placeholder: "2.13.0"
    validations:
      required: true
```

The `required: true` flags refuse a blank "it doesn't work" submission. Add a `feature.yml` companion with `idea` / `acceptance criteria` fields if your team uses GitHub Issues for planning.

## 9. CODEOWNERS

`.github/CODEOWNERS` routes review requests per file/directory. Combined with the branch protection rule **Require review from Code Owners** (set in your ruleset from §3), reviews on critical paths can't be bypassed:

```
# Default — everything routes to the maintainer
*  @maintainer-handle

# Critical infrastructure — security team must sign off
/.github/workflows/   @maintainer-handle  @security-team
/infra/               @ops-team
/src/auth/            @maintainer-handle  @security-team

# Build/release pipeline — release manager only
/.github/workflows/release-*.yml  @release-manager
package.json                       @release-manager

# Docs — self-approve is fine
/docs/  @maintainer-handle
```

Matching is **last-rule-wins** and supports gitignore-style globs. Verify the routing after pushing:

```bash
gh api repos/OWNER/REPO/codeowners/errors
# {"errors": []}  → all paths resolve to a known owner
```

A non-empty `errors` array means at least one CODEOWNERS line points at a user/team that doesn't exist or lacks repo access. Fix it before requiring code-owner reviews server-side; otherwise PRs touching those paths become un-mergeable.

## Combining the layers

| Layer | Setup time | Catches |
| ----- | ---------- | ------- |
| Multi-account SSH | 5 min | Wrong-identity commits |
| Global `commit-msg` hook | 2 min | AI-attribution in messages |
| Per-agent denylist | 5 min/agent | Casual destructive commands |
| Branch protection ruleset | 2 min/repo | Force-push, branch deletion |
| `pre-push` + `git-secrets` | 10 min | Credentials pushed accidentally |
| PR/Issue templates | 5 min/repo | PRs without context, blank bug reports |
| `CODEOWNERS` + required reviews | 5 min/repo | Critical paths merged without the right reviewer |
| `ia-user` + ACLs | 15 min | Anything that escapes the agent's denylist |
| Borg backups | 30 min | Whatever escapes everything else |

You don't need all of these on day one. Start with multi-account SSH + branch protection + the agent denylist of whatever AI you actually use; add the restricted user and CODEOWNERS the first time you delegate a non-trivial task on a repo that matters.

## Related

- [Hardening Against AI](/guides/hardening-against-ai/) — the conceptual layers and why each one matters.
- [Configuration](/guides/configuration/) — Karajan-specific config in `kj.config.yml`.
- [HU Board](/guides/hu-board/) — the dashboard that surfaces what your agents are actually running.
