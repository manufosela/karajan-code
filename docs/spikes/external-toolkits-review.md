# External agent toolkits: what Karajan can take from them

Status: for discussion with the maintainer. Nothing here is decided.
Date: 2026-11-10. Card HU-3755.

## Why this document

The project owner asked whether five public toolkits for coding agents belong in Karajan, and what Karajan could improve by looking at them. This is the record of that look, so the maintainer can answer the questions at the end.

## How it was checked

Each source was read through its public page or its repository README on the date above. Nothing was installed or run. Where a claim comes from a page and the code was not read, the table says so. Items marked "not verified" were not found in the text read.

## The five sources

| Source | What it is | Licence | Reads as | Verdict |
|---|---|---|---|---|
| Superpowers (`obra/superpowers`, in the Claude marketplace, marked verified by Anthropic) | 16 skills: test-driven development, systematic debugging, verification before completion, brainstorming, plans, subagents, code review, worktrees, a skill for writing skills. A `SessionStart` hook injects a bootstrap skill. Skills fire on their own and the README calls them "mandatory workflows, not suggestions". | MIT | A method that competes with Karajan's for control of the same agent. | Candidate for single skills in Atril's third-party catalog, after a static review. Never the plugin and never its hook. |
| `multica-ai/andrej-karpathy-skills` | One skill, `karpathy-guidelines`, and a `CLAUDE.md`: think before coding, simplicity first, surgical changes, goal-driven execution. Derived from a public post; the page does not say Karpathy took part. The README installs from another account (`forrestchang/...`), so the origin needs clarifying. | MIT | Almost all of it is already in the Karajan method. | Not now. |
| `ayghri/i-have-adhd` | A skill of 10 output-style rules (action first, numbered steps, lists capped at 5). Has `hooks/`, `scripts/`, `extensions/` and manifests for seven agents (contents of hooks and scripts not seen). The README installs by telling the agent to fetch the repository and follow its `AGENTS.md`. | MIT | Presentation, not method. The install route has the agent execute outside instructions. | No. |
| `nyldn/claude-octopus` | A plugin that sends one task to several models (Codex, Copilot, Qwen, Ollama, Perplexity, OpenRouter, Grok, Kimi and others) and flags disagreement with a 75% consensus gate. 56 commands, 64 skills, 31 personas, an MCP server, broad lifecycle hooks, an optional auto-router that reads ordinary prompts. The README says its `invoke` mode can share prompt context with the configured providers. | MIT | A rival orchestrator and reviewer. | No. The idea of showing reviewer disagreement is worth keeping (see below). |
| ECC (`affaan-m/ECC`, ecc.tools) | Plan Canvas, unified memory and handoffs (CLI and MCP), a control pane for sessions and worktrees, AgentShield (scans agent configuration, permissions, hooks and MCP connections), a GitHub App (free on public repos, 19 USD per seat per month on private ones). Installed with `npx ecc-universal install --guided`. | MIT | Overlaps Karajan's handoffs, RAG, board and audit. The page has no privacy statement. Only the website was read, not the repository. | No. The idea behind AgentShield is worth keeping (see below). |

Rule used for all five: only something that adds method Karajan lacks may enter, as a single skill in Atril's catalog, pinned to a commit and reviewed. No third-party plugin, no third-party hook, no installer that fetches code.

## Candidate improvements for Karajan

Each one is an idea from the sources, not code taken from them.

| # | Idea | From | Value | Cost | Overlaps |
|---|---|---|---|---|---|
| 1 | After three failed fixes of the same failure the coder stops and asks for arbitration or opens a root-cause card, instead of retrying. | Superpowers (systematic debugging) | Stops loops that burn tokens. | About 6 lines in `templates/coder-rules.md`. | `kj code --retry`, `kj solomon`. |
| 2 | Moving a card to done asks for evidence: the test result and the review verdict. | Superpowers (verification before completion) | Makes "done" literally true. | A small code change in `kj hu move`. | The done-statement rule in the method. |
| 3 | A page saying what leaves the machine and when: diffs to the reviewer, Sonar, the RAG, update checks. | Claude Octopus (its privacy page) | Lets people judge the exposure before using `kj review`. | One documentation file. | `kj privacy scan` covers artifacts, not this. |
| 4 | An offline scan of agent configuration: hooks, permissions and MCP servers declared in `.claude/` and `.karajan/`, flagging third-party hooks and over-broad servers. | ECC (AgentShield) | Checks what an agent is allowed to do, which `kj audit --security` does not. Needs no tokens. | A new check; medium. | `kj audit`, `kj doctor`, the Sentinel. |
| 5 | Reviewer disagreement shown as its own section of the verdict before arbitration. | Claude Octopus (consensus gate) | Makes the dual review easier to read. | Touches the verdict format; the highest of the five. | Dual review, `kj solomon`. |
| 6 | Output of Karajan's own reports in action-first form. | i-have-adhd | Shorter reports. | Design criterion, no dependency. | HU-3725 already moves the review summary this way. |

Already proposed as a result of this look (PR 3754, open at the time of writing): the review rules template carries the five review axes, an approval standard and three Karajan rules, with the Addy `code-review-and-quality` skill as the named origin.

## What was not verified

- The contents of the hooks, scripts and manifests of Superpowers, i-have-adhd and Claude Octopus.
- The manifest of the Karpathy repository and the move from one account to another.
- Whether any of the five sends telemetry.
- ECC beyond its website.
- Whether the Addy review skill reaches the reviewer through Atril today.

A static review, as done for the Cloudflare skill, is needed before any of them enters the catalog.

## Questions for the maintainer

1. Does the rule above (single reviewed skills in Atril, no plugins, no third-party hooks) match how you want the catalog to grow?
2. Superpowers: do you want `systematic-debugging` and the code review skills offered to the coder and reviewer roles, once reviewed?
3. Which of the six improvements are worth a card, and in which order? The cheapest are 1, 3 and 6.
4. For 4: should the configuration scan be part of `kj audit --security` or a command of its own?
5. For 5: is a disagreement section worth a change of the verdict format?

## Resumen en español

Se miraron cinco kits públicos (Superpowers, Karpathy, i-have-adhd, claude-octopus y ECC). Ninguno se instala: todos traen hooks, instaladores o reglas que compiten con el método de Karajan. Solo Superpowers aporta skills sueltas que podrían ir al catálogo de Atril tras una revisión estática. De los cinco salen seis ideas propias, las más baratas son el límite de tres intentos fallidos, la página de privacidad y el formato de informes con la acción primero. Quedan cinco preguntas para Manu, arriba.
