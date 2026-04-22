# OpenSkills integration

Karajan auto-injects domain-specific skills into role prompts so each AI agent
has the right context for the task at hand. This page documents how detection
works, how skills are routed to roles, how the cache behaves, and how to
customize the behavior.

## How detection works

When `kj run` starts, Karajan inspects the task text and the project files to
decide which skills to install. Detection runs in one of four modes:

| Mode | Behavior |
|---|---|
| `auto` (default) | Regex + semantic. Regex scans files and task text; the classifier agent (triage/planner/coder provider, whichever is configured) then suggests additional skills from a curated catalog. |
| `regex` | Regex-only. Fast and offline; no classifier call. |
| `semantic` | Classifier-only. Useful when the project has no obvious markers (empty greenfield) but the task description implies a stack. |
| `none` | Skill detection and installation are disabled entirely. |

Set the mode via:

```bash
kj run "task" --skills-mode=regex
```

Or in `~/.karajan/kj.config.yml`:

```yaml
skills:
  mode: auto
```

### Regex signals

The detector recognizes these stacks out of the box:

| Stack | Signal |
|---|---|
| Astro / Next / React / Vue / Svelte / Angular | `package.json` dependency |
| Express / Fastify / NestJS | `package.json` dependency |
| Java / Kotlin | `pom.xml`, `build.gradle`, `build.gradle.kts` |
| Go | `go.mod` |
| Rust | `Cargo.toml` |
| Ruby | `Gemfile` |
| PHP | `composer.json`, `phpunit.xml` |
| Python | `pyproject.toml`, `requirements.txt`, `setup.py` |
| Python data (pandas/numpy/scipy) | requirements / pyproject contains the package |
| Python ML (torch/tensorflow/scikit-learn) | requirements / pyproject contains the package |
| .NET | `*.csproj` or `*.sln` anywhere under `projectDir` (bounded walk) |
| Databases (SQL) | `*.sql` files, `schema.prisma`, `migrations/` or `db/migrate/` directories |
| Prisma | `*.prisma` files or `@prisma/client` dep |
| Jupyter / data | `*.ipynb` files |
| Test frameworks | `vitest`, `jest`, `@playwright/test`, `cypress` in `package.json`; `pytest` in Python deps |
| Elixir / Erlang | `mix.exs`, `rebar.config` |

Additionally, the task text is scanned with word-boundary regexes for common
stack mentions (e.g. "add a SQL query" → `sql-analysis`, "CSS tweak" →
`frontend-design`).

### Semantic refinement

In `auto` and `semantic` modes, the triage classifier is shown:

- The task text.
- Skills already detected by regex.
- A curated catalog of skill names.

It is asked to pick up to 5 additional skills that would meaningfully help.
Catalog-only answers: the classifier cannot invent skills. If the classifier
is unreachable (no provider configured, missing API key, transient error),
detection silently degrades to regex-only and the session continues.

## Role → skill filtering

Not every skill helps every role. Karajan applies role-specific filters so a
reviewer doesn't receive `pytest-patterns` and a tester doesn't receive
`owasp-top-10`:

| Role | Filter |
|---|---|
| `coder` | No filter — receives every detected skill |
| `reviewer` | Matches `code-review`, `security`, `lint`, `style`, `antipatterns`, `owasp`; allows `sql-analysis` |
| `architect` | Broad — receives everything EXCEPT test-framework patterns |
| `tester` | Matches `test`, `pytest`, `vitest`, `jest`, `playwright`, `cypress` |
| `security` | Matches `security`, `owasp`, `sast` |
| `planner` | Broad — same policy as architect |
| `solomon` | Matches `security`, `code-review` |

See `src/skills/skill-loader.js` → `ROLE_SKILL_PATTERNS` for the authoritative
config.

## Claude dedup (Agent Skills)

When the active provider is Anthropic (Claude Sonnet 4.5+), Karajan does NOT
inline the full contents of `SKILL.md` in the prompt. Claude can load Agent
Skills natively; duplicating the content in the prompt wastes tokens and risks
drifting from the canonical source. Instead, the prompt section is a
reference list like:

```
## Domain Skills

Skills available natively via your Agent Skills capability: react-patterns,
sql-analysis, owasp-top-10.
```

For other providers (OpenAI, Google, OpenCode, ...), the full `SKILL.md` body
is included inline as before.

## Fallback when the CLI is missing

If `npx openskills` isn't available in the current PATH, Karajan:

1. Still runs detection.
2. Emits a `skills:unavailable` progress event with a list of `wouldHaveUsed`
   skills for the final report.
3. Logs a warning suggesting `npm install -g openskills`.
4. Continues the pipeline without skills — nothing blocks.

The session report surfaces the `wouldHaveUsed` list as a recommendation so
users can opt into the benefit in future sessions.

## Local cache (`~/.karajan/skills-cache/`)

After a successful install, Karajan records the skill's install time in
`~/.karajan/skills-cache/<skill>/meta.json`. On the next session, if the
recorded install is newer than 7 days, Karajan skips the `npx openskills
install` call and treats the skill as already installed. This saves 10–30s
per skill per session.

Inspect and manage the cache:

```bash
kj skills list          # show cached skills with fresh/stale flag
kj skills clear-cache   # force re-install on next session
```

The TTL is currently 7 days and is not user-configurable in v1. The cache
stores metadata only — it never holds skill content itself.

## addyosmani/agent-skills (process skills — **first source**)

Since v2.7, Karajan also consults the [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills)
catalog **before** OpenSkills. The two providers are orthogonal:

| Provider | What it covers | Example slugs |
|----------|----------------|---------------|
| `addyosmani` (first) | Lifecycle / process skills, per role | `test-driven-development`, `code-review-and-quality`, `security-and-hardening`, `performance-optimization`, `git-workflow-and-versioning` |
| `openskills` | Stack / framework skills | `astro`, `react`, `prisma`, `vitest-patterns`, `owasp-top-10` |
| `local` | Project-specific skills under `.claude/skills/` | any slug you define |

### Bootstrap

On the first run with `skills.addyosmani.enabled: true` (default), Karajan
shallow-clones the upstream repo into `~/.karajan/agent-skills/`. Subsequent
runs re-use the local copy and refresh it with `git pull` after
`skills.addyosmani.refreshDays` (default: **7 days**). When `git` is missing or
the network is unreachable, the step degrades silently and the pipeline keeps
running with OpenSkills only.

### Role → slug mapping

The role map in `src/skills/addyosmani-role-map.js` wires each Karajan role to
its canonical workflows:

| Role | addyosmani slugs |
|------|------------------|
| `coder` | `incremental-implementation`, `source-driven-development`, `context-engineering`, `debugging-and-error-recovery` |
| `reviewer` | `code-review-and-quality`, `code-simplification` |
| `tester` | `test-driven-development`, `browser-testing-with-devtools` |
| `security` | `security-and-hardening` |
| `architect` | `spec-driven-development`, `api-and-interface-design`, `planning-and-task-breakdown` |
| `planner` | `planning-and-task-breakdown`, `spec-driven-development` |
| `impeccable` | `frontend-ui-engineering` |
| `refactorer` | `code-simplification`, `debugging-and-error-recovery` |

Task-text triggers add slugs on top. For example, any task mentioning
"performance" or "Core Web Vitals" pulls `performance-optimization`; "git" or
"semver" pulls `git-workflow-and-versioning`; "CI/CD" pulls
`ci-cd-and-automation`.

### Configuration

```yaml
# ~/.karajan/kj.config.yml
skills:
  mode: auto
  sources: [addyosmani, openskills, local]   # first match wins per source
  addyosmani:
    enabled: true
    refreshDays: 7
    repoUrl: https://github.com/addyosmani/agent-skills.git
```

To disable the addyosmani source, remove it from `sources` **or** set
`skills.addyosmani.enabled: false`.

### CLI

```bash
kj skills sync-addyosmani    # force git pull + report slug count
kj skills list-addyosmani    # enumerate slugs with their descriptions
```

## Testing behavior locally

```bash
kj run "dummy task" --skills-mode=regex --dry-run
```

Combined with `kj doctor` to verify `openskills` CLI availability:

```bash
kj doctor --verbose  # verifies skill CLI + preflight + ports + tokens
```

Set `skills.enabled: false` in `kj.config.yml` to turn off all skill
detection at the config level (equivalent to `--skills-mode=none`).
