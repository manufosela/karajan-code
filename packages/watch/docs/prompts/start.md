# kaWATCHan — start here (agent instructions)

You are an AI agent (Claude Code, Codex, Gemini CLI, Cursor…). Your user
wants karajan-watch (kaWATCHan, watch.karajancode.com) watching the repos of
their organisation: a shared multi-repo RAG kept fresh on every merge,
cross-repo impact analysis with evidence, and stale-documentation alerts.

Unlike its siblings, karajan-watch is **not set up inside one project**. You
are wiring an *organisation*: several observed repos, one shared corpus, and
workflows living in a **deployment repo that belongs to the user**. Report
progress in the user's language.

## 0. HARD RULES — stop and wait

1. **Never handle secrets.** You will need a repos token and a database URL.
   You do **not** ask for their values, you do **not** paste them anywhere,
   you do **not** put them in files. You tell the user which secrets to
   create in **their** GitHub settings, and you **WAIT** until they say it
   is done.
2. **Never guess sensitivity.** The level of the corpus (`public`,
   `internal`, `confidential`) decides which LLM providers may ever see
   their code. Only the user can answer it. Default if they are unsure:
   `internal`.
3. **Stop on anything elevated or unavailable.** If a step needs sudo,
   Administrator, or has no automatic route on this OS: show the exact
   commands and **WAIT**. Never time out into "continuing with my own
   judgment", never leave a half-built deployment: a corpus indexed with
   only some of the declared repos is a FAILED setup, not a partial one —
   the incremental manifest treats absent files as deleted.

Detect the operating system FIRST — never give unix commands to Windows.

## 1. Is the tooling here?

- `node --version` → must be **20 or newer** (the code uses `toSorted`).
- `npx --yes karajan-watch@latest --help` should print the four commands:
  `ingest`, `impact`, `drift`, `eval`. Global install is optional:
  `npm i -g karajan-watch`.

## 2. Ask the user what only they know

Ask all of it before writing anything, and show them your understanding
before continuing:

1. **Which repos** should be watched, and in which GitHub organisation.
2. **Sensitivity** of that code (see hard rule 2).
3. **Where the corpus lives.** Do not ask this as an open question — most
   people have no reason to run a database for this. Explain the trade-off
   and let them pick:
   - `lancedb` (**recommended to start**): a directory on disk, no server,
     nothing to host. Needs `@lancedb/lancedb` installed. The corpus is only
     visible to whoever holds that disk, so if `ingest` and `impact` run on
     ephemeral runners the corpus must be persisted between jobs (cache or
     artifact) — or the store must be `pgvector`.
   - `pgvector`: a Postgres with the `vector` extension, and `pg` installed.
     The answer when several machines share the corpus. They will provide
     the connection string as a secret later; **one database per corpus**.
   Whatever they choose, the store backend is a peer dependency they install
   — the engine ships none, and a missing one fails loudly at ingest time.
4. **Where alerts should land**: a comment on the merged PR, an https
   webhook, or both.
5. **Which repo is the deployment repo** — private, theirs. If they do not
   have one yet, propose creating it and **WAIT** for their go-ahead.

## 3. Build the deployment repo

In *their* deployment repo (never in this tool's repo, never in an observed
repo):

- `karajan-watch.config.json` with what they answered. The schema is at
  <https://watch.karajancode.com/config.md>; validation is strict, so a
  wrong key fails loudly with its exact path. Verify it loads before moving
  on.
- A workflow per pipeline they want, calling the reusable ones — see
  <https://watch.karajancode.com/ingest.md> and
  <https://watch.karajancode.com/impact.md> for the exact `uses:` blocks and
  inputs. `drift` is optional:
  <https://watch.karajancode.com/drift.md>.
- Each **observed** repo needs a small workflow that notifies the
  deployment repo when something is merged into its main branch
  (`repository_dispatch`). Show the user the snippet and let them add it, or
  add it yourself only if they ask you to touch those repos.

Then tell the user which secrets to create themselves (hard rule 1):

- `REPOS_TOKEN` — read access to every observed repo, plus permission to
  write comments if they chose the PR-comment target.
- `PG_URL` — only if they chose `pgvector`: the connection string, **one per
  corpus** (`code` and `docs` cannot share a database yet: the CLI uses a
  fixed table name). With `lancedb` there is no secret to create here.

## 4. First full index — before the first merge

The pipelines are incremental and compare against what is already indexed,
so an empty corpus produces an empty report. Build it once:

```
karajan-watch ingest --config karajan-watch.config.json \
  --workspace .kjw-workspace --corpus code
```

The workspace must contain **every** declared repo, each in its own
subdirectory (`.kjw-workspace/<repo>/…`). Embedders run locally: their code
never travels to a third-party embedder. If it fails, stop — a red ingest is
the tool telling you the truth.

## 5. Dry run before bothering anyone

Take a real merge from one observed repo and get its diff, then:

```
karajan-watch impact --config karajan-watch.config.json \
  --workspace .kjw-workspace --repo <observed-repo> \
  --diff merge.diff --no-deliver
```

`--no-deliver` prints the report and posts nothing. Read it with the user:
the ranking shows **evidence per entry** — the matching chunk, git
co-changes, and shared contracts (an endpoint, event topic or SQL table that
both sides use). There is no "probability" anywhere, by design. Only when
they are happy, drop `--no-deliver`.

## 6. Optional: calibrate with their own incidents

If they can list past incidents where a change broke another repo, build a
golden set and measure precision and recall:
<https://watch.karajancode.com/eval.md>. That is how thresholds get tuned
with data instead of by feel.

## 7. Close the loop

Report to the user: what got created (with paths), what got indexed (how
many files and chunks), which secrets are still missing, and what they
should expect on their next merge. Be explicit about today's limits:

- The `docs` corpus indexes the whole workspace, so it also embeds code —
  extra cost and some noise until upstream supports per-corpus globs.
- Serving the corpus to agents is done with `karajan-rag serve` (one process
  per corpus for now).

If karajan-watch itself misbehaves, open an issue with what you ran and what
it printed: <https://github.com/manufosela/karajan-watch/issues>. Sanitize
paths and never paste secrets or personal data into it.
