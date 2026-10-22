# atril — skills, commands and agents as a Karajan family module

Status: accepted
Date: 2026-10-22
Accepted: 2026-10-22, by the maintainer
Related: ADR 0003 (governance kernel, the family-package precedent), ADR 0022 (persistent
agent configuration through rulesync)

## Context

Skill management lives inside the Karajan core: `src/skills/` (8 files, ~1 580 LOC:
regex and semantic detection, an `npx openskills` client, a metadata cache, the
addyosmani catalog, the role→skill map and a loader over `.agent/skills` and
`.claude/skills`), `src/commands/skills.js`, and the install of `templates/skills/kj-*.md`
into `.claude/commands/` in `src/commands/init.js`. About 15 core files consume it directly
(pre-loop and `pre-loop-phases/ensure-addyosmani-skills.js`, flow-runner,
coder/reviewer/architect prompts, security/tester/repairer roles, `checks/skills.js`,
`commands/hu.js`, `webperf/devtools-detect.js`, `mcp/handlers/hu-handlers.js`), and the
`kj_skills` MCP tool (`src/mcp/tools.js`) drives OpenSkills.

The core carries a concern that is not orchestration, couples to one installer
(OpenSkills) and one CLI layout (`.claude/`), and loads skills by detecting and injecting
them instead of resolving what each task needs.

## Decision

1. A new Karajan family module, **atril** (the stand that holds the score each musician
   reads), lives in this monorepo as `packages/atril`, published as `@karajan-family/atril`
   with the bin `atril`.
2. atril owns **everything defined in Markdown for the CLIs** — skills, commands and
   subagents: search, install, remove, status, update and resolution per task, for every CLI
   (Claude Code, Codex, Gemini, OpenCode, …), not only Claude Code. Nothing else in Karajan
   installs or copies such a file.
   - Karajan's **roles** (`templates/roles/`, `.karajan/roles/`) are not CLI artifacts: they
     are the pipeline's own prompts, resolved per provider by `src/prompts/prompt-resolver.js`,
     and they stay in the core. A role reaches atril only as the `role` it passes to
     `resolve`, and gets its skills from there.
3. **On demand by default.** Skills, commands and subagents live in atril's store and enter
   a context only when a task asks for them (see 8). What must be in every session is
   persistent configuration, which goes through rulesync under ADR 0022; an atril artifact
   becomes persistent only when the user explicitly installs it permanently (see 10). atril
   writes into `.rulesync/` only its own persistent pieces — the bridge, the router rule,
   the artifacts installed permanently and the machinery of the plugins it installs (see
   14) — following ADR 0022's ownership rules.
4. Skills, commands and agents are **Markdown files with frontmatter**. Any CLI can read one
   and apply its instructions; nothing has to be compiled into the agent. The frontmatter
   declares at least `name`, `description` and `kind` (`skill`, `command` or `agent`). The
   author may also declare `roles`, `servers` (required MCP servers) and the relations `uses`,
   `delegates` and `related` (see 9) at the top level; those always win over what atril
   discovers. Invalid frontmatter fails loudly.
5. The Karajan core depends only on a narrow contract exported by atril:

   ```js
   resolve({ task, role, projectDir, budget }) →
     { block: [{ name, kind, source, path, content, as: "inline" | "subagent" }],
       suggested: [{ name, kind, path }], left: [{ name, path }] }
   search(query, { kind }) → [{ name, kind, description, source, installed }]
   install(ref, { kind, target }) / remove(name, { kind }) / status()
   ```

   The core injects the resolved content into role prompts (sub-agents run without a session
   to read from). A core role runs as one `claude -p` / `codex exec` call and cannot spawn a
   subagent, so the core inlines pieces marked `as: "subagent"` as a clearly delimited section
   ("delegated instructions") rather than dropping them; interactive CLIs run them as
   subagents. Interactive CLIs get the same answer through `atril route "<task>"`, which a
   short rule tells them to call before each task. Both come from one index.
6. Existing sources — local templates, addyosmani/agent-skills, OpenSkills — become atril
   sources (see 12). `src/skills/` is deleted once nothing in the core imports it.
7. **atril is fully isolated.** Karajan delegates to it; atril knows nothing about Karajan.
   - It imports nothing from `src/` or any other workspace package (`karajan-core`
     included), and it has no Karajan-specific config, paths or vocabulary. Karajan roles
     reach it only as an opaque `role` string.
   - It installs and runs on its own: `npm i -g @karajan-family/atril` or
     `npx @karajan-family/atril`, in any project, with or without `kj`.
   - It offers three equal ways in, all over the same contract: a **library** (ES module
     exports), a **CLI** (`atril`, with `--json` on every command) and an **MCP server**
     (`atril mcp`), so any agent can plug it in without code.
   - Karajan is just one consumer: it calls the library API, exactly as a third party would.
   - The store location is an input, never a hard-coded path (see 8).
   - Isolation is checked, not promised: a lint rule forbids imports outside the package, and
     a pack-smoke test installs the packed tarball in an empty directory and runs it there.

8. **Storage and loading.** Artifacts live in a store with one directory per kind, the same
   layout the CLIs use: `<root>/skills/<name>/SKILL.md`, `<root>/commands/<name>.md`,
   `<root>/agents/<name>.md`.
   - The root is passed by the consumer (`root` option, `--root` flag or `ATRIL_ROOT`); atril's
     own default is `.atril/`. Karajan passes `.karajan/`, so its artifacts live in
     `.karajan/skills`, `.karajan/commands` and `.karajan/agents`, and atril manages them.
   - The store sits **outside** every directory a CLI auto-loads (`.claude/`, `.codex/`, …),
     so nothing in it reaches an agent's initial context. Content enters a context only when
     asked for: Karajan calls `resolve` and injects the result into the role prompt; an
     interactive agent calls `atril route` or the MCP tool and reads the one path it gets back.
     The cost up front is one short rule, however many artifacts exist.
   - Installing an artifact permanently in a CLI is an explicit opt-in (see 10); it is never
     the default.

9. **Enrichment.** atril parses each artifact and completes its frontmatter with what
   indexing and relating artifacts need. The author's fields stay untouched; everything atril
   adds lives under one `atril:` key:

   ```yaml
   name: tdd
   description: Write the failing test first
   kind: skill
   atril:
     keywords: [test, tdd, red-green]       # for search
     triggers: ["add a feature", "fix a bug"] # when to use it, for resolve
     roles: [coder, tester]
     uses: [skill:testing-patterns]         # loaded with it (block)
     delegates: [agent:tester]              # loaded with it, run as a subagent
     related: [command:kj-test]             # suggested, never loaded on its own
     bundle: kj-quality                     # plugin or set it belongs to
     servers: []                            # MCP servers it needs
     hash: sha256:…                         # of the content, `atril:` excluded
   ```

   - **Relations are typed** and form a graph across kinds: `uses` (a command or an agent
     applies a skill), `delegates` (a command or an agent hands work to a subagent),
     `related` (a sibling worth knowing) and `bundle` (the plugin or set it came in).
     `atril graph [<artifact>]` shows it.
   - **Block load.** Applying one artifact — a command through the bridge, a skill or an
     agent through `resolve` — loads its **block**: the artifact plus the transitive closure
     of `uses` and `delegates`, deduplicated and ordered so each piece comes after what it
     depends on. Each delegated agent is marked as such, so the caller runs it as a subagent
     with its own instructions instead of inlining it. **A subagent's dependencies travel
     with it**: the agent carries its own block (its `uses` and `delegates`, resolved the
     same way) and none of it enters the caller's context unless the caller uses it too.
     That is why every artifact is parsed and its frontmatter completed: one request
     returns everything each context needs. `related` and the rest of the `bundle` are
     listed as suggestions, never loaded; suggestions come only from the caller's own
     context, since whatever a subagent needs already travels with it.
   - **A budget bounds the block**: a maximum of artifacts and of tokens, set by the consumer
     (Karajan passes its per-role limit, today `MAX_SKILLS = 3` in `src/skills/role-skills.js`,
     made a config key `skills.max_per_role` in the core switch). The artifact applied always
     fits: if it alone exceeds the budget, `resolve` fails naming it. Its dependencies are cut
     from the deepest up; what does not fit is named in `left` with its path, never silently
     dropped.
   - **Discovery of relations.** Enrichment is deterministic by default. A relation is
     proposed when the body names another artifact in a form agents use: `/command`,
     `skill:name` / `<plugin>:<name>`, a subagent launch (`subagent_type: x`, `@agent`), a
     link or path to its file, "use the X skill"; and from the source: artifacts of one
     plugin share a `bundle`, and a plugin's `agents` and `commands` that name its skills
     get `uses`. Keywords come from headings and the author's description. A consumer may pass an `enricher`
     function for semantic suggestions (Karajan passes one backed by its agents); atril calls
     no model on its own.
   - It writes files, so it is explicit: `atril enrich` writes, `atril enrich --check` exits
     non-zero when an artifact is not enriched or out of date (for CI), and a scan never
     rewrites anything.
   - The author's own fields (`roles`, `servers`, `uses`, `delegates`, `related`), declared
     at the top level, win over the same keys under `atril:`, which hold only what atril
     discovered; `atril enrich` never removes or rewrites them.
   - A relation to an artifact that does not exist, or a cycle in `uses` / `delegates`, is
     an error, not a warning.
   - The content hash excludes `atril:`, so enrichment never shows up as a local edit in
     `atril status`.

10. **Persistent install: the bridge and the permanent set.** CLIs reject an unregistered
   `/name` before the agent sees it, so atril registers **one** command in each CLI, the bridge:
   `/atril <name or task>`. Its file tells the agent to run `atril route` with what the user
   typed and to read and follow the file it gets back. Every artifact in the store can be run
   through it, and the only cost in the initial context is the bridge's description.
   - The bridge file is generated, carries atril's marker, and its hash is recorded in the
     ownership ledger of ADR 0022 (the ledger is the single source of hashes; the marker only
     says who wrote it). It is never written over a file atril did not generate.
   - The bridge and the router rule are atril's only persistent pieces by default.
   - On top of them, the user chooses which artifacts to install **permanently** in the agents
     (a command they want as `/name`, a subagent the CLI should be able to delegate to). Each
     one costs its description in every session, so the choice is the user's: `atril init`
     and `atril expose` ask which ones, per target (Claude Code, Codex, …); `--yes` and an
     explicit list cover non-interactive runs. `atril unexpose` takes one back to on demand.
   - The choice lives in atril's config in the store (`<root>/atril.json`): `targets`,
     `rulesync.generate` (the opt-in of ADR 0022) and, per kind, the `expose` list. The
     lockfile sits next to it (`<root>/atril.lock.json`). Both are project state and are
     committed: a consumer whose root is ignored re-includes them (Karajan adds
     `!.karajan/atril.json` and `!.karajan/atril.lock.json` to `.gitignore`). A consumer may
     ask the same questions through its own UI and write the same config; `kj init` does so.
11. **Persistent pieces go out through rulesync** (ADR 0022). atril does not keep per-CLI
    adapters. It writes the bridge, the router rule and the permanent artifacts — and nothing
    else — into rulesync's sources
    (`.rulesync/commands`, `.rulesync/subagents`, `.rulesync/skills`, `.rulesync/rules`), each
    file with atril's marker, and `atril sync` runs `rulesync generate` with ADR 0022's
    canonical arguments (whole generation). rulesync already knows where each CLI reads each kind (and ~20 of them), and
    Karajan already writes its rules through rulesync when a project uses it
    (`src/utils/rulesync.js`).
    - rulesync is a dependency of atril, not of its consumers that only call `resolve`:
      injection into Karajan's role prompts never needs it.
    - What atril may write, and how it shares `.rulesync/` with other writers (file names,
      the ownership ledger, whole generation, the opt-in to run `rulesync generate`), is
      ADR 0022's contract. atril implements it in its own package, sharing no code with the
      core.
    - In a project without rulesync, atril offers to adopt it (ADR 0022); if the user
      declines, nothing persistent is installed and atril says so.
    - `atril sync --check` exits non-zero when the generated files are out of date (for CI).

12. **Discovery and the curated catalog.** OpenSkills installs skills from git
    (`owner/repo[/path]`) but has no search, and it installs into directories CLIs auto-load
    (`.claude/skills`, `.agent/skills`) and lists them in `AGENTS.md`. atril adopts its
    ecosystem, not its install locations:
    - **Same sources, same format.** `atril install owner/repo[/path]` accepts every OpenSkills
      source and reads `SKILL.md` as OpenSkills does, but installs into atril's store. Skills
      already installed by OpenSkills are brought in with `atril import --from openskills`,
      which moves them out of the auto-loaded directories.
    - **A curated catalog.** A catalog is a list of sources, each pinned to a commit, with a
      short note on what it is for. atril ships a default one; a project adds or replaces it in
      `atril.json` (`catalogs`), and Karajan passes its own (addyosmani/agent-skills and the
      `kj-*` artifacts included).
    - **Discover before installing.** `atril catalog sync` fetches the catalog's sources into a
      cache and indexes them, enriched like any other artifact, without installing anything.
      `atril search` then covers both the store and the catalog and marks each hit
      `installed` or `available`; `resolve` can propose an `available` skill that fits a task,
      and installing it stays an explicit step.
    - **Trust.** A skill is instructions an agent will follow. Installing from the catalog
      uses its pinned commit, and the lockfile records origin, commit and hash. Installing a
      source outside the catalog asks first (or needs `--yes`), shows what it adds, and is
      recorded as `uncurated` in `atril status`. Updating moves the pin only through
      `atril update`, which shows the diff.

13. **The recommended set.** atril ships a set of skills, commands and subagents it
    recommends installing, bundled in the package (`packages/atril/recommended/`, same layout
    as a store) so it works offline and versions with atril. It is a catalog like any other
    (see 12), the one atril offers first.
    - Nothing is installed on its own. `atril init` lists the set and asks, **per artifact**:
      skip, **on demand** (into the store; the default answer) or **persistent** (into the
      store and installed permanently in the agents, see 10–11). `--yes` takes the defaults;
      `--recommended=on-demand|persistent|none` answers all at once.
    - `atril recommended` shows the set any time, each entry `installed` (and how) or
      `available`; after an update of atril, entries that are new or changed are reported,
      never installed or overwritten without asking.
    - A consumer adds its own recommended set on top, with the same questions and answers.
      Karajan's is the `kj-*` artifacts and the addyosmani process skills. The `kj-*` files
      stay bundled in Karajan's package (moved from `templates/skills/` to
      `templates/atril/{skills,commands,agents}`, which ships in its tarball) and are passed
      to atril as a catalog; `kj init` asks through its own UI and writes the same config.
    - Changing one's mind is one command: `atril expose` / `atril unexpose` move an installed
      artifact between on demand and persistent; `atril remove` drops it.

14. **Plugins, split, for every CLI.** A plugin bundles two things: Markdown that costs
    context (skills, commands, agents) and machinery that must be registered to work (hooks,
    MCP and LSP servers, `bin/`, monitors, settings, user config). Installed natively, every
    description loads in every session, and only in the CLI the plugin was written for.
    atril installs a plugin **split**: the Markdown goes to its store, on demand for every
    CLI; the machinery goes to every target CLI through rulesync.
    - **Formats in.** Claude Code plugins (`.claude-plugin/`), Agent Plugins / Codex plugins
      (root `plugin.json`, `.codex-plugin/`) and Antigravity plugins (`plugin.json`), from any
      marketplace those CLIs accept (`owner/repo[#ref]`, git URL, local path, hosted
      `marketplace.json`). A marketplace is also an atril catalog: its entries are indexed and
      searchable before anything is installed. Measured on 2026-10-22,
      `anthropics/claude-plugins-official` lists 315 plugins.
    - **Normalize.** atril fetches the plugin at a pinned commit into its cache
      (`<root>/plugins/<name>/<version>/`, a full copy) and runs `rulesync import --targets
      claudecode-plugin|antigravity-plugin --output-root <copy>` into a per-plugin canonical
      source. Hooks get rulesync's canonical event names (`preToolUse`, `sessionStart`, …).
    - **Markdown half.** Skill folders (with their `scripts/`), commands and agents — and the
      commands declared inline in `plugin.json` — enter the store under
      `<root>/{skills,commands,agents}/<plugin>__<name>` (a name valid on every filesystem;
      `<plugin>:<name>` is only how it is referred to and invoked),
      enriched and related to their plugin like any other artifact. When atril resolves one,
      it substitutes `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` with
      the cached copy and the skill's folder, `${CLAUDE_PLUGIN_DATA}` with the plugin's data
      directory, and `${user_config.KEY}` with its non-sensitive values. 41 Markdown files of
      the official plugins need this to reach their scripts.
    - **Machinery half, two routes**, chosen per target CLI:
      - **As a plugin**, where the CLI has a plugin system rulesync can write: Claude Code
        (`claudecode-plugin`) and Antigravity (`antigravity-plugin`). From the per-plugin
        canonical source (never the project's `.rulesync/`), `rulesync generate --features
        mcp,hooks --output-roots <derived>` writes a derived plugin with no Markdown. This is
        the one carve-out from ADR 0022's whole generation: it reads its own source and
        writes only under `<root>/plugins/`, never a shared output; atril adds the manifest, publishes it in a local marketplace it owns
        (`<root>/plugins/.marketplace/`) and installs it with that CLI's own command
        (`claude plugin install <name>@atril`, `agy plugin install <path>`). On Claude Code
        this keeps `bin/`, LSP servers, monitors and `userConfig` working as in the original.
      - **Into the project**, for every other CLI rulesync supports (Codex CLI, OpenCode,
        Cursor, Copilot, …): the plugin's hooks and MCP servers are merged into
        `.rulesync/hooks.json` and `.rulesync/mcp.jsonc` as entries owned by atril in the
        ADR 0022 ledger, keyed by the plugin's name, and `atril sync` generates them (Codex `hooks.json` and `config.toml`, OpenCode
        `rulesync-hooks.js`, …).
    - **Hook commands are wrapped.** Out of its plugin a script finds no `CLAUDE_PLUGIN_ROOT`.
      Every hook command atril emits is `atril hook run <plugin> <hook-id>`, which sets
      `CLAUDE_PLUGIN_ROOT`, `PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` and `PLUGIN_DATA` to the
      cached copy and the data directory, then runs the original command with the CLI's
      payload on stdin. One shim, the same in every CLI.
    - **Compatibility is computed, not assumed.** At install atril prints, per target CLI,
      what works and what is dropped, from rulesync's event support and the CLI's features:
      Antigravity runs only `preToolUse`, `postToolUse`, `stop` and the model-invocation
      events (no `sessionStart`, no `beforeSubmitPrompt`) and has no commands; `bin/`, LSP,
      monitors and `userConfig` exist only on Claude Code; Markdown-only frontmatter
      (`allowed-tools`, `model`, an agent's `tools`) has no effect on demand. A hook script
      written for Claude Code's stdin payload is marked `untested` on CLIs whose payload
      differs (Antigravity) until verified; atril does not translate payloads. On OpenCode
      plugin hooks are `incompatible`: rulesync's OpenCode plugin runs hook commands with no
      stdin and ignores their output and exit code, so atril does not install them there and
      the report says so (the plugin's Markdown half still works on demand).
    - **Choice per plugin**, as for the recommended set: skip, **split** (the default) or
      **native** (the original plugin, installed with its own CLI's command, everything in
      context, that CLI only). A plugin with no Markdown is not split.
    - **Trust and updates.** A plugin runs code. Before installing, atril lists every hook,
      server, executable and monitor it will register, per CLI, and asks. `atril update`
      re-fetches at the new commit, re-splits and shows the diff of both halves. A plugin's
      `dependencies` are installed first, the same way. A derived plugin installed from a
      local marketplace loads in place, so Claude Code does not install its npm dependencies:
      atril runs `npm ci --ignore-scripts` in the copy and fails loudly if it cannot.

### Alternatives considered

- **Extract `src/skills/` into its own package as is.** Low risk, but it keeps the
  detect→install→inject model and the coupling to OpenSkills and `.claude/`.
- **Keep it in the core behind an interface.** Smaller change, but the core keeps growing
  with every new CLI layout and source, and nothing outside `kj` can reuse it.
- **Per-CLI adapters in atril instead of rulesync.** No external dependency and full control
  of each layout, but atril would maintain, per CLI and per kind, what rulesync already
  maintains, and lag behind every CLI release.
- **Drive the OpenSkills CLI from atril.** Least code, but it gives no search and installs
  where CLIs auto-load, so every skill would land in the initial context.
- **Put every artifact through rulesync.** One mechanism, but rulesync compiles into the
  directories each CLI auto-loads, so every artifact would cost context in every session.
- **One native install per CLI.** Each CLI's plugin format and marketplace differ, Codex
  installs local plugins only from its desktop app, and OpenCode plugins are npm modules: a
  plugin would exist only in the CLI it was written for. rulesync already translates hooks
  and MCP for ~40 tools.
- **Install plugins natively and disable components.** Claude Code has no per-component
  switch: a manifest can replace `commands`/`agents` paths but `skills/` is always scanned,
  so the only way to keep a plugin's Markdown out of context is not to ship it in the copy
  Claude Code loads.
- **Expose every artifact natively.** No bridge needed, but every description loads into
  every session: the problem atril exists to remove.

## Plan

atril is built fresh, reusing existing code where it fits, in atomic PRs of ~150 net LOC.
Each PR ships with its tests and leaves the suite green.

1. **Scaffold**: `packages/atril` (package, workspace entry, `atril --version`), the lint
   rule that forbids imports outside the package, and the pack-smoke test.
2. **Model**: parse and validate a Markdown artifact (frontmatter → `{ name, kind, … }`).
3. **Scan**: discover artifacts in the store (`root` input) and in a user-level store.
4. **Enrich**: `atril enrich [--check]`, deterministic extraction, typed relations and their
   discovery, the graph and its validation (missing targets, cycles), the `enricher` hook.
5. **Search**: index and `atril search`; lexical by default, QMD when present, and the mode
   in use is always reported.
6. **Resolve**: `resolve({ task, role, budget })` and `atril route`, returning the block
   (closure of `uses` and `delegates`, ordered, within the budget) and the suggestions.
7. **Install / remove** into the store, and the config (`atril.json`).
8. **Bridge and exposure**: the bridge file, `atril expose` / `unexpose`.
9. **Sync**: write into `.rulesync/` with markers, `atril sync [--check]`.
10. **Lock and status**: a lockfile with origin and hash; `atril status` reports
    `ok` / `edited` / `missing`; `atril update`.
11. **Catalog and remote sources**: git sources in the OpenSkills format,
    `atril import --from openskills`, catalogs with pinned commits, `atril catalog sync`, and
    `available` hits in `search` and `resolve`.
12. **Recommended set**: `packages/atril/recommended/`, `atril recommended`, and the per-artifact
    questions in `atril init` (skip / on demand / persistent).
13. **Plugins**, after the spike (see Open questions):
    a. marketplaces as catalogs (fetch, index, pinned commit);
    b. normalize with `rulesync import` into a per-plugin source;
    c. the Markdown half into the store, with path substitution;
    d. `atril hook run`, the shim;
    e. the machinery half into the project (`.rulesync/hooks.json`, `mcp.jsonc`);
    f. the derived plugin and its local marketplace (Claude Code, Antigravity);
    g. `dependencies`, `npm ci --ignore-scripts`, and the trust listing;
    h. the per-CLI compatibility report.
14. **MCP server**: `atril mcp`, exposing `search`, `resolve`, `install`, `remove` and
    `status` as tools.
15. **Core switch**, one PR per area: move `templates/skills/kj-*.md` to
    `templates/atril/` as Karajan's catalog; skill loader → `resolve` with
    `root: ".karajan"` and `skills.max_per_role`; detection; `kj init` stops copying them
    into `.claude/commands/`; `kj skills` delegates to atril; the `kj_skills` MCP tool is
    removed (hosts that want it add `atril mcp`; the `kj` MCP server does not re-expose
    atril's tools); Karajan's recommended set, and `kj init` asks per artifact (skip / on
    demand / persistent) and runs `atril sync`.
16. **Delete** `src/skills/` and its shims.

Estimated PRs per step, at ~150 net LOC each: 1–3 one each; 4 three (extraction, relations
and discovery, graph and `--check`); 5 two; 6 three (closure and order, budget, `route`); 7
two; 8 two; 9 two; 10 two; 11 three; 12 two; 13 one per letter, eight; 14 one; 15 six (one
per area above); 16 one. About 40 PRs; steps 1–7 make atril usable on demand on their own.

## Consequences

- The core loses ~1 600 LOC and one concern; skill behaviour changes ship in atril.
- Any project or agent, with or without `kj`, can use atril on its own, as a library, a CLI
  or an MCP server.
- atril versions and releases on its own; Karajan pins a range like any other dependency.
- `karajan-rag` also indexes the project; sharing one index is out of scope here.

## Open questions

Spike HU-0009 (2026-10-22, Claude Code 2.1.308, rulesync 16.39.1, claude-plugins-official af59ee3a) settled:
- **Derived plugin, Claude Code: verified.** A plugin with only `hooks/hooks.json`, `.mcp.json` and a manifest, in a
  `directory` marketplace, passes `claude plugin validate` and installs, lists and uninstalls in project scope.
  Project scope still records the install in `~/.claude/plugins/installed_plugins.json` and copies the plugin to
  `~/.claude/plugins/cache/`; the copy outlives the uninstall. rulesync writes no manifest: atril writes it.
- **rulesync import is not lossless; atril normalizes before and checks after.** Events, matchers, `if`,
  `asyncRewake`, `timeout` and `${CLAUDE_PLUGIN_ROOT}` round-trip; `rewakeMessage`/`rewakeSummary` and `hooks.json`
  `modules` are lost. A flat `.mcp.json` (9 of 14 official) imports as zero servers without a warning: atril wraps it
  in `mcpServers` before import and fails loudly if the server count changes. A plugin that would lose a field is
  offered native-only, never split silently. `--output-root` takes a normalized absolute path.
- **OpenCode: hooks incompatible.** Through rulesync its plugin runs hook commands with no stdin and ignores
  stdout and exit code. Decided: atril marks OpenCode plugin hooks `incompatible` and does not install them;
  an atril-owned OpenCode plugin piping the event into `atril hook run` can be revisited later.

Still open:
- The Codex hook payload: rulesync emits Claude-shaped `.codex/hooks.json` and leaves the payload to Codex. Needs
  Codex installed and one recorded payload per event; until then Codex hooks are `untested`.
- Whether Claude Code installs npm dependencies for a `directory`-marketplace plugin (it copies it to the cache).
- Hooks and `mcpServers` declared inline in `plugin.json` (no official plugin does it): untested.
- Whether Codex gets the plugin route too: it reads `.claude-plugin/marketplace.json` as a legacy source and sets
  `CLAUDE_PLUGIN_ROOT`, but its CLI installs local plugins only through the desktop app. Until verified, Codex takes
  the project route.
