---
title: Command reference
description: Every live kj command, grouped as kj advanced groups them.
---

The commands a v4 setup uses. Everything supports `--help`; agent-facing commands offer `--json` (stdout = exactly one JSON object). The first three sections are where to start; the sections after them list every other command, in the same groups as `kj advanced`. To work without kj in the way, see [Working without kj](/docs/guides/working-without-kj/).

A **human act** is typed by a person in their own terminal; kj refuses it from an agent. They are marked as such below.

## Setup (once per project, run by a human or their agent)

| Command | Does |
|---|---|
| `kj init` | Config + rules + quality tooling. Agent-safe: falls back to defaults without a TTY, `--json` summary. |
| `kj start [task]` | Single entry point: assesses the project and recommends the next step (`--maturity new\|existing\|legacy`, `--yes` applies nothing, `--json`). |
| `kj go` | Starts Karajan from nothing: detects your agent, prepares the project, opens the board and leaves you in the conversation (`--window` keeps the conversation inside the browser board). |
| `kj bootstrap` | From an empty directory to the method ready: repository, configuration, harness, gate and RAG, in the order that works. |
| `kj update` | Updates karajan-code to the latest version from npm. |
| `kj env install` | Installs or refreshes the method playbook in AGENTS.md, the one file every host agent reads (`--target`), builds the RAG index (`--no-rag`) and installs the git hooks and the verdict gate (`--no-enforce` skips them). Exit 3 when the RAG cannot index: an action is pending from you. |
| `kj harden` | Git hooks (lint, commit policy, gate runner), configs, CI workflows. Chains your previous global hooks. `kj harden --commit` is a human act: typed by a person in their own terminal; kj refuses it from an agent. |
| `kj review --install-gate` | Declares the pre-commit review gate (`.karajan/review-gate`, to commit). It is enforced only when the `kj harden` pre-commit hook runs it; otherwise it says so and exits 1. |

## Daily (run by the agent)

| Command | Does |
|---|---|
| `kj hu add\|move\|list` | The [HU Board](/docs/guides/hu-board/) from any host agent, card first. `add "<title>"` puts work on the board (`--tier trivial\|standard\|deep`, `--ac`, `--ref`), `move <id> <status>` moves it (pending, running, done, failed, skipped), `list` shows it. |
| `kj code --card <id> --brief` | Has the coder declared in your panel write the card, with a clean context. `--brief` returns only the end of the coder's answer; `--retry` after a rejected review gives the coder its findings, on the most capable model. If the coder removed an assertion of an existing test, the run fails, lists each removed assertion and asks to restore it and `--retry`. |
| `kj handoff` | What a gate denied the agent, or what only the human can do, registered for the human to run by id: `add`, `list`, `show`, `done`, `wait`, `watch`. |
| `kj rag query "<q>"` | Semantic search over the project (auto-refreshes on drift). |
| `kj brief <role>` | Mission + invariants + deliverable of a role. No role → list. |
| `kj review --staged` | Deterministic pre-gates first, in this order: card first, Steward, PR size, privacy, tests with the code, policy, Sonar on the changed files (BLOCKER/CRITICAL reject), RAG, mutation when declared, the diff's own test files, cooldown. The first rejection ends it without a model. Then the cross-AI review: a diff larger than one reviewer prompt is reviewed whole, in batches of whole files, approved only if every batch is, and a file too large for one prompt rejects the verdict. Verdict bound to the diff's sha256 and stamped with its workspace. Exit 0/1. |
| `kj worktree start\|list\|done <slug>` | Isolated task lanes: worktree + `feat/<slug>` branch + dependency bootstrap; `start --base <branch>` cuts the lane from `origin/<branch>` (an epic branch, say) and keeps it as the lane's base for `pr-size`, `check` and the review gate; `done` removes a merged lane. `list --json` gives each lane's commits ahead of the base and the cards its branch names (by id or reference); `--prs` adds each lane's PR (one `gh` call). The HU Board shows them on each card. |
| `kj review --check` | Is there an approved verdict for the exact staged diff? (What the hook runs.) |
| `kj review --range <a..b>` / `--lane <slug>` | Reviews a git range instead of the staged diff / runs the gate in that lane from any directory. |
| `kj review --publish-pr <n>` / `--verify-pr <n>` | Publishes the verdicts of a PR's commits on it as one GitHub review / the CI check: every commit of the PR is listed, with its diff hash, in the kj review a member published. |
| `kj review --third-party` | Reviews someone else's PR (`--range base...head`): reviewer only, no own-work gates, no verdict stored (`--lens qa`, `--verifier`, `--reviewers`, `--json`). |
| `kj solomon --position "<why>"` | Third-AI arbitration of a rejected verdict. Exit 0 approve / 1 reject. |
| `kj solomon --finding <id> --position "<why>"` | Arbitrate one finding of the verdict. Approving it removes it; the gate opens only when no finding is left. A security finding is never arbitrated. |
| `kj agent run <agent> "<task>"` | Delegate a task to another AI and print its output. |
| `kj report-issue --title "<t>"` | File a sanitized kj bug upstream. Never publishes without `--publish`. |

## Inspect (human)

| Command | Does |
|---|---|
| `kj check` | Verifies the quality harness installed by `kj harden` (drift gate). |
| `kj doctor` | Checks the environment requirements and fixes what it can (`--check-only`, `--json`). |
| `kj report` | Last session's summary, budget, iterations. |
| `kj board` | HU Board dashboard. It does not start when the board is external (`state_backend: external`) or `hu_board.enabled` is false, unless `--force`. |

## Agents and review

| Command | Does |
|---|---|
| `kj code` | Has the coder declared in your panel write the task (`--agent`, `--card`, `--brief`, `--retry`). |
| `kj solomon` | A third AI arbitrates a rejected review verdict (`--position`, `--finding`, `--range`). Brain, reviewer and Solomon are three different AIs. |
| `kj agent run <agent> <task>` | Delegates a task to another AI agent and prints its output. Exit 0/1. |
| `kj scan` | Runs a SonarQube scan. |
| `kj tournament` | Fans the same task out to N coders (`--coders`) in isolated lanes and collects each lane's diff, suite and log. `--score`, `--judge` and `--crown` score, rank and commit the winner through the review gate. |

## Analysis

| Command | Does |
|---|---|
| `kj discover [task]` | Analyzes a task for gaps, ambiguities and missing information (`--mode gaps\|momtest\|wendel\|classify\|jtbd`). |
| `kj spec refine` | Proposes a detailed spec, and its e2e tests, from a high-level one, to accept before the plan. Never overwrites the output. |
| `kj onboard` | Analyzes an existing codebase and produces an Architecture Brief. |
| `kj brief [role]` | Shows the distilled method of a role: triage, planner, researcher, architect, tester, security, board or audit. With no role, lists them. |
| `kj plan` | Plan management: `list`, `show`, `ready`, `validate`, `delete`, `share`, `unshare`, `add-hu`, `remove-hu`, `license`, `fix`, `migrate-result`. |

## Search / RAG

| Command | Does |
|---|---|
| `kj rag` | Semantic search over plans, onboarding briefs and project code: `index`, `query`, `covers <file>`, `migrate`, `install-hooks`, `eval`, `mcp`. |
| `kj qmd query <text>` | Semantic search over the project's QMD wiki (`docs/`, `.reviews/`, `.karajan/plans/`); `--scope docs\|reviews\|plans`. |
| `kj watch start\|stop\|status` | A daemon that re-indexes the RAG as files change (`--with-sources`, `--foreground`). |
| `kj doc index\|section` | Reads a markdown file by its headings: `index` lists them, `section <file> <heading>` prints one section whole. |

## Quality / audit

See [Gates](/docs/v4/gates/) for how the gates use these and [Governance](/docs/v4/governance/) for the rule model.

| Command | Does |
|---|---|
| `kj audit [task]` | Codebase health analysis; it never changes your code (each run is kept in `.karajan/audit-history.db`). `--deterministic-only` spends no tokens; `--security` is a zero-token security pass; `--sbom <file>` writes the CycloneDX SBOM. |
| `kj check` | Verifies the quality harness installed by `kj harden` (drift gate). |
| `kj mutate [path]` | Mutation testing scoped to your diff (`--since`, `--max-survivors`): do your tests catch the mutants of your change? |
| `kj webperf <url>` | Lighthouse scan of a URL: Core Web Vitals and opportunities (`--mobile`). |
| `kj sonar status\|start\|stop\|logs\|open` | Manages the SonarQube container. |
| `kj privacy scan [paths...]` | Scans files, the staged diff (`--staged`) or a range (`--range`) for personal data, always masked in output. A denylist hit exits 1; generic PII warns. |
| `kj release` | Release ceremony: `check`, `propose <version>`, `status <issue>`, `ack <issue> ok\|hold\|include`, `verify <tag>` (the CI gate). `kj release approve <issue>` is a human act: typed by a person in their own terminal; kj refuses it from an agent. |
| `kj policy eval\|check\|grant\|report\|anchor\|add\|seal` | Policy as code in `.karajan/policy.yml`. `eval` and `check` are deterministic (`--strict` exits 2 on deny); `grant` gives a non-security exception with an expiry; `add` turns a spoken rule into the policy vocabulary and writes only with `--yes`; `anchor` seals the decision log's head hash; `report` summarizes the log and grants; `seal` is called by the Sentinel. |
| `kj rules list\|eval\|test\|check\|compile\|decide\|review\|approve\|coverage` | The rules written in your MD files, compiled into `.karajan/rules.yml`. `review` has a different AI check a proposal; `coverage` shows each rule's gate. `kj rules approve` is a human act: typed by a person in their own terminal; kj refuses it from an agent. |
| `kj rulesync adopt\|release <key>` | The `.rulesync/` ownership ledger: `adopt` takes an entry's current content as kj's, `release` hands it to you and kj stops writing it. |
| `kj claims check\|gate` | Cross-checks the data an AI states in a turn against that turn's outputs. Exit 2 only when a figure is contradicted by its own source. |
| `kj continuation gate` | Called by the stop hook: the turn does not end while the session's cards remain, except for a reason kj can check (`method_gates.continuation`: block, warn or off). |
| `kj steward sweep\|bench` | The Steward governs the project's state: `sweep` is a read-only pass over the invariants and writes a versioned report; `bench` runs one detector commit by commit over a range. |
| `kj pr-size` | Lines the branch adds against its base, with the CI budget (`--limit` exits 1 over it). |
| `kj main-guard` | Audits a push to the protected branch: merges without their required checks, and the protection. Exit 1 with a markdown report. |
| `kj main-guard-except <pr>` | A human act: typed by a person in their own terminal; kj refuses it from an agent. Signs on the phone an exception for a PR merged without its required checks (`--why`). `kj main-guard` reads it; `kj harden` installs no workflow that runs it. See [a seal in a pull request](/docs/guides/sentinel/#a-seal-in-a-pull-request). |
| `kj merge-gate` | Whether a `gh pr merge` command may run now: exit 2, with the reason, while the PR's checks run or are red. |
| `kj gates [value <rule>\|set <rule> <value>]` | Lists the rules kj governs with, each adjustable one with its value and who set it; `value` prints one resolved value (for hooks); `set` changes an adjustable one: tightening is free, loosening is a human act (typed by a person in their own terminal; kj refuses it from an agent). With `--from-contributing "<sentence>"` the value is justified by that exact sentence of the project's CONTRIBUTING, with no human act. Fixed rules never change. |
| `kj hooks [set <step> <command>\|unset <step>]` | Lists the command each hook step runs and where it comes from; `set` pins one, `unset` releases it. `set` and `unset` are human acts: typed by a person in their own terminal; kj refuses them from an agent. The hooks change only after `kj harden` and its seal. |

## Session / board

| Command | Does |
|---|---|
| `kj report` | Shows the latest session report (`--list`, `--session-id`, `--trace`, `--format`). |
| `kj board start\|stop\|status\|open\|cleanup` | The [HU Board](/docs/guides/hu-board/). With no action it starts a persistent server in the background. |
| `kj hu add\|adopt\|tier\|move\|start\|list\|migrate\|backend` | Cards from any host agent. `start <id>` opens the lane and moves the card to running; `adopt <number>` turns a GitHub issue into a card; `backend github\|linear\|local` turns the board on. |
| `kj stage` | Opens the live 3D stage of the project: what the Sentinel, `kj review` and the Ledger do, as it happens. |
| `kj adr add\|list` | Architecture decision records in `.karajan/adrs/`, tracked by git. |
| `kj worktree start\|list\|note\|done\|prune` | Isolated task lanes. `note` leaves a short note on a lane; `prune` retires lanes that are provably abandoned (`--dry-run`). |
| `kj sentinel status\|verify\|hook\|panel-check\|board-gate` | The [Sentinel](/docs/guides/sentinel/): the deterministic method supervisor wired into the harness hooks. `status` prints the session's facts, `verify` checks the harness scripts against the installed kj. |
| `kj identity show\|set\|enroll-phone\|phone-invite` | Which gh account and git email this clone is worked with. `kj identity enroll-phone` is a human act: typed by a person in their own terminal; kj refuses it from an agent. |
| `kj security show\|max\|critical\|normal` | The project's security level. `max` needs no signature. `critical` and `normal` are human acts: typed by a person in their own terminal; kj refuses them from an agent. With a phone enrolled, the phone signs them; with none, the level is recorded unsigned and `max` applies again as soon as a phone is enrolled. |
| `kj handoff add\|list\|show\|done\|wait\|watch` | Handoffs: `add` registers a denied command, or with `--why` an action only the human can take; `wait <id>` blocks until it is done (exit 0) or the timeout passes (exit 2); `watch` is the human's task window. |
| `kj link send\|inbox\|threads\|limits\|ceremony` | Agent link: post to `issue:<n>` or `pr:<n>`, or read what arrived (on demand, never pushed). `ceremony convene\|gather\|close` convenes a daily, refinement or retro, gathers what was said, or writes its result as a pull request and closes it. |

## Infra / setup

| Command | Does |
|---|---|
| `kj install-tools` | Installs the tools kj needs (git, agent CLIs) and the external audit tools (semgrep, osv-scanner, lighthouse, docker, sonar) with your package manager (`--only`, `--yes`, `--dry-run`). |
| `kj ollama start\|stop\|status\|pull <model>` | Manages the RAG embedder container (Ollama in Docker). |
| `kj skills` | Manages the skill cache (`list`, `clear-cache`, `sync-addyosmani`, `list-addyosmani`) and the `.karajan` store: `search` (kj's own, it translates a non-English query first) and, through atril, `route`, `scan`, `install`, `remove`, `graph`, `enrich`, `config`. |
| `kj atril` | Runs atril's own CLI on the `.karajan` store; every argument goes to atril untouched. |
| `kj roles [show <role>]` | Lists the pipeline roles; `show <role>` prints a role's template instructions. |
| `kj agents [list\|set <role> <provider>]` | Lists or changes the AI agent of each role (`--local`, `--global`). |
| `kj account add\|list\|remove\|default\|use\|check\|pace\|rescue` | Agent accounts: the login each provider's agents run on. See [Accounts](/docs/v4/accounts/). |
| `kj env install` | Installs or refreshes the playbook for host agents in AGENTS.md, and the git hooks and verdict gate (`--no-enforce` skips them). |
| `kj init` | Config, review rules and SonarQube. Run once per project. |
| `kj config` | Shows the current config (`--json`, `--edit`, `--check-secrets <file>`). |

## Maintenance

| Command | Does |
|---|---|
| `kj clean` | Garbage-collects stale plans, sessions and HU batches. Dry run unless you pass `--yes`. |
| `kj sync` | Detects drift between the code and the latest plan. Read-only; `--apply` writes the report back into the Canvas. |
| `kj telemetry preview\|status` | Shows exactly what telemetry sends and whether it is enabled. It never opens a socket. |
| `kj report-issue` | Reports a kj bug or friction to the public repo, sanitized. Publishing needs `--publish`. |

## Retired in 5.0

`kj run`, `kj autorun`, `kj resume`, `kj standby`, `kj plan generate`, `kj status`, `kj undo`, `kj triage`, `kj researcher`, `kj architect` and `kj review "<task>"` drove the old subprocess pipeline and were retired with it: they answer with a notice and start nothing. What replaces each one: [Migrating to 5.0](/docs/v4/migration/). For CI and scripts, see [Unattended runs](/docs/v4/headless/).

`kj advanced` lists the commands by group, as above. The old pipeline is documented in the **V3 historical archive** ([here](/docs/getting-started/introduction/)).
