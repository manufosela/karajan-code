# Design skills: what Karajan can take from three public sources

Status: for discussion with the maintainer. Nothing here is decided.
Date: 2026-11-10. Card HU-3756. Companion to the spike on external toolkits (HU-3755, branch `feat/HU-3755-external-toolkits-review`, not merged when this was written).

## Why this document

The project owner asked which design skills Karajan could add, or learn from. Three sources were read. Karajan already carries a design role, `impeccable`, so the first question is what that role covers and lacks, not what to import.

## How it was checked

Each source was read through its public page or README on the date above. Nothing was installed or run, and no script was read. Items marked "not verified" were not in the text read. The state of the `impeccable` role was checked by reading this repository's code (grep over `src`, `templates`, `docs`, `tests`; the lane's RAG index was empty, so the code itself was read).

## The three sources

| Source | What it is | Licence | How it runs | Verdict |
|---|---|---|---|---|
| Taste Skill (`Leonxlnx/taste-skill`, site tasteskill.dev) | A frontend design skill, `design-taste-frontend`. Three Node scripts: `draw.mjs` deals 3 of 20 design directions at random; `scripts/assets.mjs` finds licensed pictures (Openverse, Wikimedia Commons, two museums); `scripts/inspect.mjs` opens the page in a real browser at 1440, 768 and 390 px and fails it on "slop" (checks named: `few-pictures`, `off-centre`, `edge-text`, `blank-gap`), for up to three fix rounds. Since v2.1 it also checks app screens. | MIT | Installed with `npx skills add Leonxlnx/taste-skill`. Needs Node 22 or newer and Chrome, Edge or Chromium. No API keys; the network is used to find pictures, and what a search sends is not stated. A build takes about 30 to 45 minutes and a few hundred thousand tokens (the page's own figure). | Not installed. The idea of an executable design check with a threshold is worth keeping. |
| `vercel-labs/agent-skills`, skill `web-design-guidelines` | A 39-line skill that reviews UI code and reports findings as `file:line`. | Not read (the repository licence was not checked). | The skill has no rules of its own: on every review it fetches `command.md` from another Vercel repository (`vercel-labs/web-interface-guidelines`, branch main) with WebFetch, and that remote file holds the rules and the output format. | Not installed. Remote content that changes without a pinned commit breaks Atril's rule that each source is pinned. The `file:line` format with a fixed rule list is worth keeping. |
| `bergside/awesome-design-skills` | A registry of 67 visual-style skills (Brutalism, Glassmorphism, Shadcn and similar), each with a `SKILL.md` and a `DESIGN.md`. | MIT | Installed with `npx typeui.sh pull <slug>`, a third-party CLI that writes the files for your agent. | Not installed. It is product taste, not method, and the installer fetches code. |

## What Karajan already has: the `impeccable` role

Karajan ships two role templates, `templates/roles/impeccable.md` (125 lines) and `templates/roles/impeccable-design.md` (87 lines). The first describes an "Impeccable Design Auditor" that runs after SonarQube and before the reviewer, audits only the frontend files in the diff, and checks, among others, accessibility: missing ARIA labels, no `focus-visible` styles, missing `alt` text, non-semantic HTML, missing skip links. It reports APPROVED at once when the diff holds no frontend file.

### Is it still wired? No: it is text that nothing runs

Checked on main at the date above. `kj run` was the only flow that ran it (post-loop stage after the coder), and it was retired in 5.0.

- There is no `ImpeccableRole` class: `src/roles/` holds only `agent-role.js`, `audit-role.js`, `base-role.js`, `discover-role.js`, `onboarder-role.js` and `spec-reviewer-role.js`. The post-loop stage files named in `docs/ARCHITECTURE.md` (`post-loop-stages.js`, `impeccable-role.js`) no longer exist; that document is stale.
- The MCP direct runner (`src/mcp/direct-role-runner.js:58`) mentions `impeccable` only in a comment; its two handlers run `discover` and `audit` (`src/mcp/handlers/direct-handlers.js:127,143`).
- `src/mcp/run-kj.js:52` still maps an `enableImpeccable` option to `--enable-impeccable`, but that flag belonged to the retired `kj run`.
- Nothing reads the setting. `src/config/defaults.js:26,41` declare `impeccable: { provider: null, model: null }` and `impeccable: { enabled: false }`; `src/commands/init.js:873-875` sets `config.impeccable.enabled = true` when a frontend is detected, `src/utils/stack-detect.js` suggests it, and `role-resolver.js`, `model-selector.js`, `schema.js`, `overrides.js` list the name. Those are configuration plumbing with no consumer.
- `templates/roles/impeccable.md` can only be read: `resolveRoleMdPath` (`src/roles/base-role.js:18`) builds its path for `kj roles show`-style lookups, and `tests/roles/impeccable.test.js` checks the file exists and mentions "Impeccable". No flow loads it as an instruction. `impeccable-design.md` has no reference in `src`.
- `templates/roles/triage.md` and `templates/roles/karajan-brain.md` still tell a triage or brain agent to pick `impeccable`; `kj brief triage` gives that text to an agent, which then has no role to activate.
- `src/skills/addyosmani-role-map.js:71` maps `impeccable` to `frontend-ui-engineering`, only used when a role name is passed to the skill resolver, which no flow does for this role.
- `MIGRATION-v5.md` does not name `impeccable`. It retires `kj run`, `kj autorun`, `kj triage`, `kj researcher`, `kj architect` (replaced by `kj brief <role>`) and the MCP tools that drove the pipeline, and says nothing about the post-loop roles.
- `src/review/ui-evidence.js:7-8` calls `impeccable` "an AI OPINION about the diff" and, in its place, asks for evidence a person can see (the `method.ui.evidence` rule, a warning in `kj review`). That is the only live design-related check today.

So the design audit exists as 212 lines of prompt, docs in English and Spanish, and a test that checks the file exists. It is not executed.

What the role was, compared with the sources: a prompt that asks a model to look. Taste Skill's inspector is a script that renders the page and fails it with a number. That is the gap.

## Candidate improvements

| # | Idea | From | Value | Cost | Overlaps |
|---|---|---|---|---|---|
| 1 | The `impeccable` role is not wired (see above): retire it (the two templates, config keys, the `triage` and `karajan-brain` mentions, the stale docs and the test), or bring it back as a `kj brief impeccable` or an executable check. | Our own repository | Removes dead text, or restores a design audit. | Retire: small to medium, touches many files; bring back: depends on idea 2 or 3. | `impeccable.md`, the retired `kj run`, `ui-evidence.js`. |
| 2 | An offline design check on the rendered page: contrast, text at the edge, touch size, the 390 px view. Deterministic, no tokens. | Taste Skill (the inspector) | Turns design criteria into a gate with a threshold, in the Karajan style. | A new check in `kj audit` or a command of its own; medium to large. Needs a browser. | `impeccable` (as a prompt), `kj audit`, `ui-evidence.js`. |
| 3 | Accessibility and UX rules with an identifier and a `file:line` result, written by us and fixed in the repository. | Vercel (the format) | The reviewer can cite a rule by id and the result can be checked. | The rules list plus the reviewer wording; small to medium. | The existing UI/UX guidelines ("accessible, mobile-first, no native alert"). |
| 4 | A random choice of design direction to avoid look-alike pages. | Taste Skill (`draw.mjs`) | Varied output. | Small, but it is a product choice. | None. Probably not for Karajan. |

Not proposed: installing any of the three, the 67 style skills, or a skill that downloads its rules at run time.

## What was not verified

- The contents of the three Taste Skill scripts and what an image search sends.
- The Vercel repository licence and the content of the remote guidelines file.
- The `typeui.sh` CLI.

A static review, as done for the Cloudflare skill, is needed before any of them enters the catalog.

## Questions for the maintainer

1. The `impeccable` role is not wired: do we retire it (templates, config keys, `triage` and `karajan-brain` mentions, stale docs) or replace it with an executable check (ideas 2 and 3)?
2. Is an executable design check (idea 2) in scope for Karajan, or is design left to the project? It needs a browser, which Karajan does not otherwise require.
3. If it is, should it live in `kj audit` or be its own command?
4. Idea 3 (rules with an id and `file:line`): worth a card now, as an extension of the new review rules (PR 3754, open when this was written)?
5. Do we agree that a skill that fetches its rules from a remote branch at run time never enters the catalog?

## Resumen en español

Se miraron tres fuentes de diseño (Taste Skill, `web-design-guidelines` de Vercel y `awesome-design-skills`). No se instala ninguna: la primera ejecuta scripts de terceros con navegador, la segunda descarga sus reglas de una rama remota en cada uso y la tercera es gusto de producto con un instalador externo. Lo que se aprende: un check de diseño ejecutable (como el inspector de Taste Skill) y reglas con identificador y `archivo:línea`. Se comprobó el rol `impeccable`: no está conectado tras retirar `kj run`; es texto que nada ejecuta (plantillas, claves de config sin consumidor, docs desfasadas). Quedan cinco preguntas para Manu, arriba.
