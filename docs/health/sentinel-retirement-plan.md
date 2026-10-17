# Executing ADR 0014 and ADR 0015: retiring the Sentinel's shell-reading guards (KJC-TSK-1081)

ADR 0014 and ADR 0015 were accepted on 2026-10-03: guards are real modules, no more shell-parsing patches inside templates, the Sentinel stays small and the method is enforced at checkpoints the agent does not touch (git hooks, CI, branch protection, kj's own commands). They were not carried out: `src/harden/sentinel-hooks.js` still holds ~1,100 lines of templates, and the shell-reading guards kept growing patch by patch (52 fix commits in 30 days, see `2026-10-17-audit.md`). This plan executes them.

## Rule for every retirement

A guard leaves the Sentinel only when a checkpoint already gives its protection, proved by a test. The retirement PR names that checkpoint and its test. Templates change, so each release that ships retirements needs the human seal.

## Inventory (PreToolUse Bash, in order)

| # | Guard | What it reads | Checkpoint that replaces it | Status |
|---|---|---|---|---|
| 1 | Deny recorder | exit code | infrastructure, not a guard | stays |
| 2 | Supervisor files by Edit/Write path | tool path (structural) | | stays |
| 3 | First touch of `rm` | shell text | goes with #9 | retire |
| 4 | Supervisor files named in a Bash command | raw text | seal tamper check (PreToolUse and Stop) plus host sandbox write deny on `.karajan/harness` | retire after the sandbox rule |
| 5 | AI attribution in `gh pr/issue/release` bodies | raw text + body files | pre-commit diff and commit-msg (commits); CI attribution workflow (PR body) | retire for PRs; issue/release bodies: decide |
| 6 | `gh issue create` to karajan-code | raw text | `kj report-issue` is the documented route; low value as a guard | retire |
| 7 | Phone enrollment as a human act | raw text | `kj identity enroll-phone` checks its own caller (KJC-TSK-1084). The phone key file itself: no checkpoint yet (sandbox) | command retired; key file stays |
| 8 | `kj harden --commit` as a human act | raw text | `kj harden --commit` refuses a process descended from an agent (ADR 0009); its check now fails closed (KJC-TSK-1084) | retired |
| 9 | Discards (`git checkout --`, `restore`, `rm`) | raw text | host sandbox for writes outside the lane; inside the lane, nothing reads text reliably | decide with the user |
| 10 | `KJ_SENTINEL_OFF` | env | | stays |
| 11 | Identity lock (own tokenizer) | raw text | git part: pre-commit (author) and pre-push (every pushed commit, gh session), KJC-TSK-1085. gh part: no checkpoint sees `gh` API calls (the incident behind it) | git part retired; gh part stays |
| 12 | Lane guard MONO-0 (cd, quoted paths, substitutions, path tokens) | raw text | host sandbox limited to the lane directory | retire after the sandbox rule; largest source of false positives |
| 13 | Repo writes through Bash | raw text | card-first and rag-first are enforced at commit; the Steward's block too since KJC-TSK-1086. Still only here: unsealed governance files (`kj.config.yml`, `.ragignore`) written through Bash | waits for the sandbox to deny those paths |
| 14 | Policy engine on the Bash input | whole input | policy gate at commit (`kj review`) and CI policy job | retire from Bash |
| 15 | `--no-verify` / `core.hooksPath` | raw text | CI required checks and branch protection catch an unhooked commit | waits for branch protection on `main` (an admin act; `main` is unprotected today) |
| 16 | `git add` blanket / runtime files | raw text | runtime files: pre-commit rejects them. Blanket `git add -A` sweeping unrelated files: no checkpoint | runtime part retirable; blanket part stays |
| 17 | Board-sync on merge/advance | raw text | move to a merge-time check (post-merge hook or CI) | redesign |
| 18 | Claims in a PR body | raw text | CI claims check | retire after CI has it |
| 19 | Release check before publish/deploy | raw text | `kj release check` in the release script and `prepublishOnly` | retire after the script runs it |
| 20 | Push gate | raw text | pre-push hook plus branch protection on `main` | waits for branch protection |

Edit/Write gates (steward, card-first, rag-first) read structural signals (the tool's path) and stay, as ADR 0015 allows.

## What the remaining retirements wait for (2026-10-18)

- **The host sandbox** (pilot KJC-TSK-1083): it works on this machine (AppArmor profile for bubblewrap) and blocks writes to sibling repos and `.karajan/harness` at the OS level. `gh` is solved (`excludedCommands: ["gh *"]`); a local SonarQube still needs the proxy (the sandbox sets `NO_PROXY=localhost`). Unblocks #4, #12, #13 and the phone key file.
- **Branch protection on `main`** with the method's required checks (an admin act that kj prints and never runs). Unblocks #15 and #20.

## Order

1. Host sandbox rule: `kj harden` configures the host's sandbox so writes stay in the lane and `.karajan/harness` is read-only. Unblocks #4 and #12.
2. Retire the ones already covered, one PR each: #8, #11, #13, #15, #16, #20, then #5 (PRs), #6, #14.
3. Move #17, #18, #19 to their checkpoints, then retire them.
4. Decide #9 with the user.
5. What remains in templates moves to real modules (ADR 0014) and the templates only import and wire.

Success measure: fix commits on `sentinel-hooks.js` and `sentinel-shell.mjs` per month, and false-positive denials in `denials.jsonl`.
