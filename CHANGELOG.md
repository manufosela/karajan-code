# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Member reachability: the credible core of the dead-code inventory** (KJC-TSK-0794 part 1, epic KJC-PCS-0082): a new analysis says which class members no entrypoint can reach — but ONLY inside the perimeter validated with known truth (GREBLA's hand-checked 31/139 at dd5a91a and 0/108 on their cleaned main): one file, a recognized framework contract, no dynamic dispatch. Entrypoints are what the framework calls, declared per framework and VERSIONED (Lit and custom elements to start), never a hand-kept list; a decorated member counts as registered by the framework; static blocks run at definition time and keep what they touch alive; recursion does not keep itself alive; `#private` members are followed like any other. Everything outside the perimeter — a computed `this[expr]` anywhere in the file, an unknown or mixin base class, a computed member name, a file that will not parse — comes out **NOT OBSERVABLE with its reason**, never as clean: an inflated inventory gets switched off, and then nobody reads the dead code that is real. Wiring into `kj audit` and the derivative-first report arrive in the next parts of the card.
- **Member reachability, part 2: static slots and constructor fields** (KJC-TSK-0794 part 2): static and instance are different worlds — an instance `this.foo` cannot run a `static foo`, so the analysis now keys members by slot, the entrypoint catalog (v2) says which entrypoints the framework touches statically (`properties`, `styles`, `observedAttributes` in Lit), `this` inside static blocks and static initializers resolves to the static slot, and a `ClassName.X` use anywhere in the file is a static root — a use is a use, wherever it sits. And the gap the AST cannot see (GREBLA's six constructor fields): a `this._x = …` assigned in the constructor with no declared member and exactly ONE `this._x` appearance in the whole file exists only to be initialized — reported in its own `constructorFields` section, labeled as the heuristic it is, never mixed with the reachability findings.
- **The dead-code report leads with the DERIVATIVE** (KJC-TSK-0794 part 3, AC8): "went from N to M since the last audit" is what a reader acts on — the absolute is now the secondary datum in both dead-code blocks of `kj audit`, and the knip block also says how many findings ENTERED the scan and how many were FILTERED as declared false positives, so a shrinking number can never hide a shrinking scan. "Not measured before" prints no derivative at all — never a fake zero: the previous snapshot only participates when it actually measured, and each audit snapshot now records the knip totals for the next one to compare against.
- **The dead-code scan recognizes the project's REAL entrypoints** (KJC-TSK-0794 part 4, AC7): a Firebase callable or a Playwright global-setup reported as dead is exactly the false positive that gets an inventory switched off. When the project has no knip config of its own, `kj audit` now declares FOR it what it can read: `firebase.json`'s `functions.source` becomes a scanned workspace (the platform's word) and `config.audit.entrypoints` adds anything kj cannot deduce (the user's word) — a project with its OWN knip config is respected untouched, and the report says which declared entrypoints were honored so the shrink is auditable, not silent.
- **Deleting code no longer owes a test** (KJC-TSK-0795 part 1, AC1, epic KJC-PCS-0082): measured in GREBLA on 22-aug — the tests-with-code gate fired on both cleanup PRs, and every false positive teaches people to skip the gate. Now a diff whose touched sources only REMOVE lines is exempt in both places the rule lives: `kj review --staged` hands the gate the numstat, and the Sentinel's Stop gate asks git whether the session's source edits added a single line before demanding a test. Deleting adds no behavior to test; one added line anywhere re-arms the gate, unreadable git keeps the violation (a gate never stands down on a shrug), and callers that only know file names keep the old behavior.
- **The sonar pre-gate only vetoes what the PR actually touched** (KJC-TSK-0795 part 2, AC3): measured in GREBLA — a 3-line PR was listed 30+ preexisting issues and blocked by debt it never wrote. `kj review --staged` now maps the exact lines the diff ADDS (`--unified=0`) and only issues on those lines can block; issues on untouched lines — or with no line at all — are the file's TREND: counted and reported (`sonar trend: N preexisting issue(s)…`), never a veto. The scan still always runs before issues are read (single-flight), so a stale server analysis has no route to reject current code — stated as an invariant where it holds.
- **The generated line budget stops counting weight nobody wrote** (KJC-TSK-0795 part 3, AC4+AC5): measured in GREBLA — a 414-line budget warning that was almost all `pnpm-lock.yaml`. The shrink-budget workflow `kj harden` generates now excludes `pnpm-lock.yaml`, `npm-shrinkwrap.json`, `dist/`, `build/`, `coverage/`, snapshots and every lockfile — the same exclusions kj's own repo applies (fixed by test). And the pr-size warning now says how much of the weight is the module's OWN tests (`230 lines added (150 source + 80 accompanying tests — partition by feature, never code from its tests)`): partitioning stays a decision, made with the numbers in view, and the criterion stops nudging anyone to ship a module separated from its tests.
- **The privacy scan learned context: a git SHA is not a phone number** (KJC-TSK-0797, epic KJC-PCS-0082): measured twice — GREBLA's pinned Actions reported as phone numbers, and this repo's own workflow pinning flagged twelve times in one 9-file PR, punishing exactly the security practice worth encouraging. Now 40/64-hex git object ids and emails on RFC 2606 documentation domains (`example.com/org/net`, `.test`, `.invalid`, `.localhost`, `.example`) are discarded BEFORE the generic detectors — and COUNTED: a clean result says whether it found nothing or found-and-explained (`N candidate(s) discarded by context`), in prose and in `--json` (`discardedByContext`). The personal denylist still runs first — the user's own datum blocks even when it looks like a fixture — and a real email still warns: the discard opens no false negative, each case fixed by test.
- **The Steward's verdict kernel: trust expires like permission does** (STW-A part 1, KJC-TSK-0789, epic KJC-PCS-0081): a green nobody has re-earned is not a green. Every Steward invariant now answers ONE of four things — `ok`, `broken`, `unknown` (the evidence expired → remedy: refresh) and `not-observable` (there was never anywhere to look → remedy: instrument) — because confusing the last two with ok is exactly the false green that let GREBLA degrade: their workflows fire only on `pull_request`, main has not one run of its own, and "how long has main been red" had no possible answer while 21 days of red E2E hid a 17-day production bug. Ships with invariant #1 (the base branch has CI of its own and it is green, red tolerated `main_ci_red_days` before it counts as decay), freshness defaults CALIBRATED with GREBLA's measured decay and SAID out loud when a project declares nothing, a dependency rule (a child of a not-observable parent inherits it, never ok) and a probe rule (a probe that throws is unknown — never a green light). The sweep, the in-repo report and the execution modes arrive with the next cards of the epic.
- **The Steward ages the security surface** (STW-A part 2, KJC-TSK-0789 AC5+AC6): "never" is GREBLA's real case — 79 days with an open redirect and untouched dependencies, and no audit on record. `kj audit` now records every run in `.karajan/steward/security-audit.json` (mode security or full), and the new `security-audit` invariant ages it: no record is **broken with "never"** — not unknown, because running the audit fixes both "never" and "unrecorded" the same way; past `security_audit_days` shows the counter. And vulnerable dependencies age by the **advisory's published date** (osv's `published`, now carried through the collector), never the discovery's — the clock started when the world knew; a critical with no date counts as overdue, because unknown age is not youth.
- **The Steward's remaining decay invariants** (STW-A part 3, KJC-TSK-0789 AC3+AC4+AC7): dead code informs by DERIVATIVE and carries **no security weight** — in GREBLA the sensitive functions stayed in the bundle but the backend rules kept protecting them, so growth is the decay signal (`+8 since the last audit`), a first measurement is where the trend starts (never decay), and a missing measurement is unknown, never a clean bill. Coverage is an invariant of **configuration, not of value**: either something measures the level (any threshold the team stands behind — no 80% is demanded) or nothing does, and "nothing measures it" is the definition of not-observable. Phantom coverage delegates honestly: until KJC-TSK-0800 ships its two detectors, the invariant answers not-observable — never ok by absence of its detector.
- **`kj steward sweep`: the project's state, versioned in the repo** (STW-B part 1, KJC-TSK-0790, epic KJC-PCS-0081): a READ-ONLY pass over the Steward invariants that leaves the verdict where everyone can see it — `.karajan/steward/report.md` for a person (verdict, last evidence, and the command that RENEWS each invariant) and `report.json` for a machine, which is also the baseline the next sweep compares dead-code against: the versioned report is the shared memory, never a record on one machine (the ADR's decision for repos touched by several people or several karajans). The verdict is deterministic — two sweeps with no changes differ only in the `Last swept` line — exit is 1 only when something is BROKEN (unknown and not-observable inform with their remedy, they do not fail the sweep), `gh run list` is the live probe for invariant #1, and a gitignored report path is warned about: a report nobody can see is not shared state. And every sweep is SEALED in the hash-chained decision log (`kind: steward-sweep`, verifiable with the kernel's `verifyDecisionChain`) — recorded, not just notified: the same criterion policy decisions already meet — while a live osv probe feeds the vulnerable-deps invariant when `osv-scanner` is installed (unavailable stays unknown: a missing scan is never a clean bill).
- **The sweep's verdict has consequence where work starts** (STW-C, KJC-TSK-0791, epic KJC-PCS-0081): on the first edit of a session, the Sentinel reads the Steward's versioned report and INFORMS — impossible to miss, once per session, with the sweep date and the exact remedy per invariant; unknown asks for a refresh and is never treated as broken (nothing is asserted that is not known). It BLOCKS almost never: only a broken `vulnerable-deps` or `main-ci` — the defendible subset — and only when the project explicitly adopted `method_gates.steward: block`, with `KJ_ALLOW_STEWARD=1` as the recorded session escape. A project with no report is not gated at all: adoption is explicit. GREBLA's own conclusion, taken as design: what would have saved them was not a harder gate — it was someone saying "the E2E have been red for 21 days".
- **Every break is PROPOSED work on the board** (STW-D, KJC-TSK-0792, epic KJC-PCS-0081): after the report and the seal, `kj steward sweep` cards each broken invariant on the HU Board the brain already consumes — evidence, since-when, and a remedy plan explicitly marked as a PROPOSAL that nothing executes unreviewed (an unreviewed generated plan can do more harm than the decay itself). The same break UPDATES its card keeping since-when — a daily sweep never floods the board with twins — and a green invariant resolves its card with the green evidence, validation staying with the user. Boards kj does not own (planning-game, external) are never mirrored (a half-empty parallel board is worse than none): the sweep says so loudly and the Sentinel's inevitable notice pushes the host agent — who does have the board's tools — to card them; a board failure never costs the report or the seal.
- **PR bodies are now crossed against the turn's outputs before the PR exists** (CLM-C, KJC-TSK-0803, epic KJC-PCS-0083): a PR body outlives the turn — an invented figure there misleads every future reader. `kj claims gate|check --file <path>` crosses the CONTENT of a file (a PR body, a card, a note) against the transcript's outputs instead of the final message, and the PreToolUse hook detects `gh pr create|edit --body-file <f>` and runs the gate before the PR is created: a datum **denied by its own source** blocks with the exact inspect command; the hook still carries no policy (`method_gates.claims` decides, `off` by default) and fails open on anything it cannot read. Inline `--body` text and the remaining artifact ACs (CHANGELOG at commit time has no transcript; already-published content predates any transcript; cards via MCP need their own matcher) are documented on the card as deliberate scope, not silence.
- **The Stop gate now checks the AI's final message against the turn's own outputs** (CLM-B wiring, KJC-TSK-0802, epic KJC-PCS-0083): the last piece of claims-with-evidence acts. The hook carries no policy — it spawns `kj claims gate`, and kj reads `method_gates.claims`: `off` (default: adoption is explicit), `warn` (report only), `block` (a datum **denied by its own source** refuses to end the turn, with the exact command to inspect it; unbacked data is still only reported). It runs even without a tracked session — a turn with no edits still ends with a final message — and fails open when kj is missing or the transcript unreadable: a broken verifier never holds a session hostage. The wiring test drove the generated hook with the real binary and caught a design bug the unit tests had blessed: the user *asking* "how many cards are left?" mentioned the noun and vetoed the denial — a question says nothing about emptiness, so only tool outputs take part in the denied analysis now.

## [4.22.0] - 2026-08-27

### Added

- **Karajan Console is born: `packages/console` and the `console.config.json` v1 contract** (C0 part 1, KJC-TSK-0776, epic KJC-PCS-0080, ADR 0007): the admin web console of a family instance starts as a private workspace package (`@karajan-family/console`, published from C1). Its first piece is the ONE contract the instance brings: `console.config.json` validated fail-loud with valibot — instance and allowed domains, Google auth, roles by email or `@domain` (admins required), corpora (`gcp-cloud-run`), operations (`github-workflow`), write-only secrets (`gcp-secret-manager` / `github-secret`), the watch config repo with its pinned version, and the audit sink (`file` / `gcs-jsonl` / `memory`). Semantic checks on top of the schema: every principal inside an allowed domain, no duplicate ids; every problem is listed, never the first one only. `resolveRole` answers admin > operator > reader, or nothing for another domain. The fixture mirrors the first real instance (tribbu-atlas). Tests live in `tests/console/` so the root suite covers the package.
- **Karajan Console: who is calling, verified on the server** (C0 part 2, KJC-TSK-0776): `createAuth({ config, verify })` — the ID-token verifier is injected (Google's keys through `google-auth-library` in production via `@karajan-family/console/google-verifier`; a stub in tests) and the console never trusts a claim it did not verify: `email_verified` must be true, the audience must match when declared, the `hd` claim must be one of the instance's allowed domains (a personal Google account has no `hd`: no organisation, no entry), email and `hd` must agree, and the role comes from `console.config.json` — no role, no entry. `requireRole(minimum)` is the express middleware: Bearer token → `req.identity` (email, role, sub, hd) or the `AuthError` as JSON (401 no_token / invalid_token / wrong_audience; 403 unverified_email / domain / no_role / forbidden), with reader < operator < admin enforced by rank.
- **Karajan Console: the audit trail** (C0 part 3, KJC-TSK-0776): `createAudit({ sink })` records every console action (who, action, target, outcome, detail) on the same append-only hash-chained kernel kj uses for policy decisions (`@karajan-family/governance`), verifiable offline with `verify()`; `wrap()` seals ok / denied / error around any action and re-throws. Secrets never land in the trail — a detail whose key looks like one is refused loudly, not redacted quietly. Sinks are the only I/O: `memory` for tests, `file` (chains across instances from disk); `gcs-jsonl` arrives with the GCP adapter in C1 and says so instead of pretending.
- **Karajan Console: the app and the adapter registry** (C0 part 4, KJC-TSK-0776): `createConsoleApp({ config, verify, sink, adapters })` is a plain express app — exportable as a handler for Cloud Run or Firebase Functions — wiring auth, audit and adapters. `GET /api/status` is public and minimal (instance, version, which adapters this build registers and which the config needs but lacks); `/api/me` (reader), `/api/config` (reader: the public view — ids, adapters, availability, never a secret's name), `/api/audit` (admin: chain verification + last entries). Every refusal is JSON and every denied auth attempt is sealed in the trail with what the token claimed (or `anonymous`). Adapters declare capabilities (`health`, `listAccess`, `grant`, `revoke`, `dispatch`, `runStatus`, `runLog`, `secretWrite`, `proposeConfigChange`); asking for one an adapter lacks fails at wiring, never at runtime; a `memory` adapter serves tests and dry runs. Real adapters and the `karajan-console serve` bin arrive with C1.
- **Karajan Console: the `gcp-cloud-run` adapter** (C1 part 1, KJC-TSK-0777): corpus health through the service's private URL with an ID token minted for it by the console's service account, and people's access as the `roles/run.invoker` binding of THAT service — never the project — read-modify-write with the policy's etag so a concurrent edit fails loudly, other bindings untouched, grant idempotent, revoking the last invoker drops the binding. Cloud Run REST v2 with Google auth injected (`createGoogleCloudAuth` on google-auth-library / ADC in production, a stub in tests): no SDK, no gcloud.
- **Karajan Console: corpora and access routes** (C1 part 2, KJC-TSK-0777): `GET /api/corpora` (reader) answers every corpus with its health — an unreachable service is reported on that corpus, never as a 500; `GET/POST/DELETE /api/corpora/:id/access` (admin) list, grant and revoke people on the service's invoker binding through the adapter, with the email checked against the allowed domains (400 otherwise), an unknown corpus 404, a missing adapter capability 503, an adapter failure 502 — and every grant/revoke sealed in the trail with who did it and to whom, outcome ok or error.
- **Karajan Console 0.1.0: `karajan-console serve`** (C1 part 3, KJC-TSK-0777): the reference way to run the console as a plain Node process — `karajan-console serve --config console.config.json --port 8080` (env `CONSOLE_CONFIG`, `PORT`) loads the config fail-loud, wires Google's verifier and the ADC-backed `gcp-cloud-run` adapter, prints its URL and which adapters the config still lacks, and stops cleanly on SIGTERM; `KARAJAN_CONSOLE_ADAPTERS=memory` is the dry run the smoke test uses. README with the instance contract, the roles, what the console's service account needs and the C1 API. The package leaves `private` behind: `@karajan-family/console@0.1.0` is what tribbu-atlas instantiates (ATL-TSK-0010).
- **Karajan Console 0.1.1: the `gcs-jsonl` audit sink** (C1.1, KJC-TSK-0784, from tribbu-atlas' field test of 0.1.0): on Cloud Run or Functions the filesystem is ephemeral, so the v1 sink had to exist before C1 could be instantiated — one IMMUTABLE object per entry in the bucket (names ordered by instant, sequence and pid), the chain rebuilt from the bucket at start and nothing served before it is known, every append uploaded and AWAITED: a refused upload is a 502 and never a sealed entry; a denied auth attempt whose seal fails is shouted on stderr, never swallowed. Plus the field notes: `GOOGLE_CLOUD_QUOTA_PROJECT` for user ADC, the bucket roles the console needs (create + view, never delete), and the startup line now says the adapters the config names but this build lacks arrive with C2–C4 — the config is fine.
- **Karajan Console: the `github-workflow` adapter** (C2 part 1, KJC-TSK-0778): operations are `workflow_dispatch` runs in the deployment repo, authenticated as a GitHub App installation — an RS256 JWT signed with `node:crypto` (no new dependency) mints a short-lived installation token, cached until close to expiry, never a PAT. `dispatch` fires the workflow with ref and inputs and, because GitHub returns no run id, locates the run by workflow, branch and creation instant with a few retries — when it does not show up the ref is `pending` with the dispatch instant, never an invented id. `runStatus` and `runLog` (jobs and steps summary; the log zip stays on GitHub). App and installation ids live in `console.config.json` (`github`); the private key only in the environment (`CONSOLE_GITHUB_APP_KEY`), never in git.
- **Karajan Console 0.2.0: operations over the API** (C2 part 2, KJC-TSK-0778): `GET /api/operations` (reader) lists what the config defines and whether this build can run it; `POST /api/operations/:id/dispatch { inputs }` fires it — only for the roles the operation names (admin qualifies by rank), inputs validated as a small map of strings and sealed in the audit trail, so an input that looks like a secret is refused before any adapter sees it (the first test run caught the adapter firing before the trail refused — the gate moved in front); `GET /api/runs/:ref` and `/log` read a run through the adapter its ref belongs to (`github:` / `memory:`; anything else is refused). `karajan-console serve` wires the `github-workflow` adapter when the config declares operations: `github` ids in the config, the key from `CONSOLE_GITHUB_APP_KEY` or `CONSOLE_GITHUB_APP_KEY_FILE`, and a missing key stops the start instead of serving operations that cannot run.
- **Karajan Console 0.2.0: the page** (C1-UI, KJC-TSK-0785, from tribbu-atlas' question "when does the UI arrive?"): the console is usable without a terminal — `karajan-console serve` serves a plain HTML + JS page at `/` (no framework, no build: the package ships `ui/` as is; `createConsoleApp({ ui: false })` keeps a process API-only). Google Identity Services signs people in with the OAuth client id from `auth.audience` (public on `/api/status` with the allowed domains; the page says so loudly when the audience is missing); the ID token travels on every call and the SERVER decides — the page shows what the API answered: identity and role, corpora with their health, access lists for admins (grant by email, remove behind an inline confirmation — no native dialogs), operations with a Run button only for the roles the operation names and the run's status polled until it settles, and the audit trail with the chain verdict. The visual check in Chrome caught a real one: `.who { display: flex }` beat the `hidden` attribute, so `[hidden]` now wins over any display rule.
- **`kj claims check`: the data an AI states, checked against what actually ran** (CLM-B part 2, KJC-TSK-0802): one command joins the two halves — read the turn from the transcript, cross its data against that turn's outputs — and answers with an exit code the Stop gate can act on. **Exit 2 only when a datum is DENIED by its own source**; unbacked data is reported and does not block, as the accepted ADR requires. It **fails open**: a transcript it cannot read is announced as "nothing checked", never as clean, because a broken verifier must not hold a session hostage. Deterministic and free — no model in the loop.
- **The scoped name is now the primary one everywhere the product teaches its install** (MIG-B, KJC-TSK-0752, ADR 0004): README, GETTING-STARTED (EN/ES), the landing's install and quick-start pages and the in-code remedy messages (`kj doctor` fixes, init warnings) all say `npm install -g @karajan-family/code`, with the legacy name kept as a one-line compatibility note per surface — it still installs the same versions and never breaks. And `kj release check` gains a **dual-publish lockstep check**: while the package ships under two npm names, their `latest` dist-tags must match — a torn dual-publish (one name released, the other not) is invisible from the repo, both installs "work", and every surface teaching one name silently diverges from the other. The pair is read from `scripts/dual-publish.mjs`, the one place that knows it; an unreadable registry fails the check, because unverified is not verified. Proven against the real registry: both names at 4.21.0.
- **This repo's own workflows now pin their actions to a commit SHA** (KJC-BUG-0153, issue #1374): `kj audit --security` flagged every `uses: …@v5` in `.github/workflows` under semgrep's mutable-action-tag rule — a tag is moved by whoever owns the action, so pinning to one is trusting a third party with the pipeline, the repository and the workflow secrets. What kj *generates* has been pinned for a while; what kj *is* had not caught up, which is the more embarrassing half of the report. The six actions in use are now pinned to full SHAs with their exact version in a comment, resolved from GitHub's API rather than written from memory — a wrong SHA breaks the workflow and an almost-right one is worse than a mutable tag. semgrep over `.github/workflows`: **zero findings**, down from one per `uses:` line. The workflows under `packages/*` are a separate job: several are generated by `kj harden` and the right fix there is to regenerate them, not to edit them by hand.
- **Shell injection in the reusable `ingest` workflow of karajan-watch** (KJW-BUG-0008, found by `kj audit --security` — one of only two ERROR-level findings in the whole monorepo): the ingest step interpolated `${{ inputs.config-path }}`, `${{ inputs.workspace-dir }}` and `${{ inputs.corpus }}` straight into `run`. GitHub substitutes those *before* the shell sees the line, so whoever calls this reusable workflow could have run arbitrary code in the runner — with `PG_URL` sitting in that same step's environment. The inputs now travel through `env:` and are used as quoted shell variables, which is what the step right above it already did: it was a slip, not a decision. Verified both ways with semgrep — one finding before the fix, none after.
- **`kj board` no longer starts a server when the config says the board is off** (KJC-BUG-0152, issue #1427 reported by @dfosela): with `hu_board.enabled: false`, `kj board` with no action still started the daemon and bound a port — while `kj doctor` reported the board as skipped. Two commands saying opposite things about the same config, and a background process nobody asked for. It now refuses, names the config key and the `--force` way out, and exits non-zero; `stop` and `status` stay allowed, because cleaning up or asking is never the surprise. `--help` also says outright that the bare command starts a persistent server, which is what caught the reporter out. The test drives the real binary in a hermetic `KARAJAN_HOME`: if the wiring were wrong it would leave a stray server behind — exactly the bug — and no mock can prove that.
- **Windows: kj no longer writes invalid TOML into `~/.codex/config.toml`** (KJC-BUG-0151, issue #1426 reported by @dfosela): the `karajan-mcp` block was written with raw Windows paths inside double-quoted TOML strings, where `\` opens an escape sequence — so `C:\Users\…` made the file unparseable and codex failed to load its ENTIRE config, `codex login` included. kj believed it had configured the MCP; what it had actually done was break a tool the user never touched. Paths are now written as TOML **literal** strings, which interpret nothing (a path containing a quote falls back to the escaped basic form). The fix lives in one module used by both the installer and the postinstall — the bug was duplicated in both. The test parses the generated block with a real TOML parser, because the bug *was* generating invalid TOML: it reproduces the reported error before the fix and returns the exact paths after it.
- **Claims with evidence: reading one turn out of the transcript** (CLM-B part 1, KJC-TSK-0802): `readTurn` pulls out of the session's own JSONL what is needed to check a turn — the AI's final prose (thinking and tool calls are the AI working, not the AI reporting), every tool output since the user's last real message, and what the user actually asked. A `user` entry carrying a `tool_result` is the machine answering, not a new turn, so outputs from the previous turn never leak in. A half-written line is skipped instead of throwing: a transcript being appended to is still readable. Nothing is annotated by hand — this only reads what the session already wrote.
- **Claims with evidence: crossing what was said against what actually ran** (CLM-A part 2, KJC-TSK-0801): the transcript of a turn is already the register of sources — every command, query and read left its output there — so nothing has to be annotated by hand. `crossCheck` gives each datum one of four verdicts: **backed** (it appears in some output, or the user wrote it), **unbacked** (it appears nowhere, so it came out of the model's memory), **denied** (the very output that should support it says otherwise) or **not checkable**. Only *denied* is a proven hallucination and only it will block; the rest is reported. Running it over a REAL message of this session caught a bug the synthetic tests had missed: "4 cards" came out backed because a `4` appears inside "24,6 kB" — numbers now have to match as whole tokens, and that case is in the suite.
- **Claims with evidence: what counts as a checkable datum in what an AI says** (CLM-A part 1, KJC-TSK-0801, epic KJC-PCS-0083, ADR accepted): a model states an invented figure with the same confidence as a measured one, and that figure travels to a PR, a card, another session or the user, where nobody checks it again. `extractClaims` pulls out of a text exactly what can be verified — counts with a unit, versions, file paths, card ids, PR numbers, SHAs — and leaves prose alone, because prose is not verifiable. Deterministic and free: no model in the loop, since verifying has to be cheaper than inventing. Two decisions worth naming: a sentence that already admits it is unverified ("de memoria", "creo que") is left alone, because admitting you did not check is the behaviour to encourage rather than punish; and a bare number with no unit is never extracted, so an OTP never ends up quoted inside a report.
- **`kj review`: the verdict path now actually unwraps, and the test proves the path instead of a helper** (KJC-BUG-0146, second half): the previous fix taught `normalizeReviewPayload` to unwrap `{ok, result}` and its test went green — but the path `kj review` walks calls `parseMaybeJsonString`, which only PARSES and returns the wrapper untouched. The bug survived behind a passing test on a function that path never called, and the next review failed exactly the same way. Now the review path normalizes what it parses, and the new tests drive `runOneShotReview` itself: they fail if the wiring is wrong no matter how correct the helpers are. **A test can only prove the code it actually runs** — that is the lesson, and it is the same false green Karajan exists to prevent.
- **`kj review`: the root cause of the unreadable verdicts, found with the evidence the previous fix started saving** (KJC-BUG-0146): codex wraps its answer as `{"ok":true,"result":{approved,…}}`, and the parser only unwrapped `result` when it was a **string** — so a perfectly good approval was discarded as "no parseable verdict" eight times in three days, and each one cost a manual re-run with another reviewer. Object wrappers are now unwrapped too, rejections included: a wrapper must never turn a "no" into a lost verdict. Unwrapping is not guessing — a wrapper whose `result` is not a verdict is still refused. The test case is copied literally from the saved raw answer, which is exactly what the first fix was for: making the bug diagnosable came before fixing it, and it took one review to hand over the cause.
- **`kj review`: an unreadable verdict now leaves evidence** (KJC-BUG-0146): when the reviewer answered something the parser could not read, the error said "no parseable verdict" and threw the answer away — eight occurrences in two days produced zero evidence, which is exactly why the bug stayed undiagnosed. The whole answer is now written next to the verdicts (`.karajan/reviews/<hash>.unparseable.txt`, outside git) and an excerpt travels in the error, with one line describing what came back (empty, not a string, or its first characters). What does NOT change: an unreadable answer is still a refusal. It could be a rejection in the wrong shape, and quietly retrying with another reviewer would turn a legitimate rejection into an approval — that decision needs the evidence this fix finally collects.
- **Guard: a class member declared twice** (KJC-TSK-0796, from a real bug in GREBLA): declaring the same member twice in a class is legal JavaScript — the last one wins and the first disappears in silence, with no runtime error, no lint warning and no compiler complaint. That is how a `updated()` that loaded the data was lost and a tab stayed empty in production for **17 days**. The finding says what was LOST, not that there is a duplicate: "the `updated` of line 304 never runs, the one of line 679 replaces it" — one sends you to fix it, the other only to look. No false alarms: `get`/`set` pairs, static against instance, and TypeScript overload signatures are all legal and stay silent; a duplicated private name is a syntax error the language already catches. What it cannot read — broken syntax, member names computed at runtime — is reported as NOT OBSERVABLE, never as clean. Ran over 1004 files of this repo: zero findings, zero blind spots.
- **Karajan Console: identity behind Identity-Aware Proxy** (C1-IAP part 1, KJC-TSK-0798, asked for by tribbu-atlas): `auth.provider` becomes a choice — `google` (Sign-In in the page, needs an OAuth client created by hand) or `iap` (Identity-Aware Proxy in front of the service, provisioned entirely by infrastructure). It exists because a console whose identity provider cannot be provisioned is not installed, it is half installed. With `iap` the assertion in `x-goog-iap-jwt-assertion` is VERIFIED against Google's public keys, the audience of this service and IAP as issuer — the console never trusts a header for coming from a proxy, so reaching the service by another path grants nothing. Keys rotate, so a cached key that stops verifying is refetched once; keys just fetched are not, because that would only hide an invalid token behind retries. `auth.audience` is required with `iap` and its shape is checked (the project NUMBER, not its id): a wrong audience turns every request into a silent 401.
- **Karajan Console: behind IAP the token travels in IAP's header, and the domain is still decided here** (C1-IAP part 2, KJC-TSK-0798): with `provider: "iap"` the assertion is read from `x-goog-iap-jwt-assertion` instead of the `Authorization` header (a Bearer is not accepted there, and vice versa), `email_verified` is not demanded because IAP does not emit it, and the audience was already enforced by the verifier — but `allowedDomains`, the role from `console.config.json` and the sealing of every refusal stay exactly where they were. That IAP let someone reach the service grants nothing by itself: the second layer never trusts the first. `karajan-console serve` picks the verifier from the provider and says which one it uses on startup; an `iap` config without audience does not boot.
- **Karajan Console 0.3.0: the page behind IAP** (C1-IAP part 3, KJC-TSK-0798): with `provider: "iap"` the page does not load Google Sign-In at all — Google authenticated the person before the request reached the console, and asking again would be asking twice for the same thing; signing out uses IAP's own logout, because behind IAP the session is IAP's cookie and only IAP can end it. A refusal no longer sends the person to sign in again either: that would loop them through IAP straight back to the same refusal, so the page shows the server's reason instead. README with the two providers side by side and what each one costs to provision.
- **Karajan Console: the audit trail no longer breaks under concurrent requests** (KJC-BUG-0150, found by tribbu-atlas on Cloud Run with the `gcs-jsonl` sink): seven refused requests in ~300 ms produced four entries with `prev = null` and a chain that verified as broken — with an async sink every `record()` read the last line before the previous upload had landed. Entries are now sealed one at a time per process (a queue: the next entry computes its `prev` only once the previous one is sealed and uploaded; a refused upload drops its own entry only and the queue goes on); synchronous sinks are untouched. The reproduction is the test. Field notes in the README: no `GOOGLE_CLOUD_QUOTA_PROJECT` on the Cloud Run service, tag the image with the config hash, keep `max_instances=1` per bucket.

- **`kj policy report` — the data behind "a rule is born warning and gains teeth" and "giving up leaves a trace"** (PL-E, KJC-TSK-0767, epic KJC-PCS-0074): two claims the policy layer made with nothing behind them — warns were never sealed and nobody counted denies, grants or renewals. Now the commit allow seals the rules that WARNED (`warn_rule_ids`), and a deterministic report (no I/O beyond the two jsonl, no LLM — evidence must be reproducible in CI) answers per rule: warns, denies, exempts and OPEN denials (denies after the last allow/exempt — the log ends in rejection; declared heuristic, the log carries no branch or author), with `enforcement`/`class` resolved from the loaded policy; grants alive / expired / expiring (`--soon <days>`), point exceptions, and renewals (≥2 permanents on one rule, expired included — that IS the sediment); and signals: a rule granted N times is the policy asking for change, a warn rule that warned ≥5 times and never blocked asks for a decision (promote or retire), open denials, grants about to expire. `--json` for CI or dashboards; a broken hash chain is exit 1 — a report over a tampered log is not a report.
- **Policy at the release boundary — `kj release check` re-evaluates what ships against the policy in force** (KJC-TSK-0769, epic KJC-PCS-0074): tier C re-checks each PR at merge time, but the policy can change between the last merge and the publish, and nothing re-evaluated what was about to ship. New generic check `policy`: the range since the last `v*` tag (the whole tree when there is none — said, never a silent green) goes through the same engine with the CURRENT policy; `enforcement=deny` violations turn the release RED naming rule and file, warnings are counted, and diff-threshold invariants — PR-scoped by definition, a whole release always exceeds a 200-line budget — are skipped and declared. Invalid policy → RED with the load error.
- **Tool-time decisions join the hash-chained decision log** (GOV-F, KJC-TSK-0768, epic KJC-PCS-0076): "every action records which rule was evaluated, under which policy version, and who approved the exception" was true only at commit time — tier A denials and `KJ_ALLOW_*` escapes lived in the Sentinel's volatile state, outside the chain and outside the git anchor. Now `kj policy eval --strict` (the Sentinel's contract) seals every deny as `chokepoint=tool` with rule, role, tool, policy hash and the sha256 of the tool input — a failed seal is said and the deny stands, never an allow by registry failure — and every escape the Sentinel honours is sealed as `exempt` through the new `kj policy seal --escape <name> --tool <tool>`, carrying the clone's DECLARED identity. Escape sealing is best-effort with a loud stderr: failing closed there would trap the session exactly when kj cannot load, which is when the escape is needed. Tool-call allows are never sealed (noise, not evidence). `kj policy report` and `kj policy anchor` see the new entries with no change.
- **HU Board: governance endpoint per project** (GUI-A, KJC-TSK-0771, epic KJC-PCS-0076): `GET /api/governance?dir=<project>` returns what so far only the terminal showed — the declared policy flattened into rules (`roles.<role>.<cap>.<kind>` with patterns, enforcement and class, plus invariants), the deterministic report from `kj policy report --json` (a broken chain is data, not a server error), the anchor state (sealed head, length vs current, stale) and the clone's declared identity. The board stays decoupled from the CLI tree: kj is spawned, the rest is read from `.karajan/`. 400 without `dir`, 404 when the directory is not a karajan project, 503 `installable` when kj is missing. Read-only — the Governance tab (GUI-B) and the actions (GUI-C) come next.
- **HU Board: the Governance tab — the acta** (GUI-B, KJC-TSK-0772): a live exception is invisible; one that must be renewed has a name, a date and a reason in front of someone. The new tab shows, per project: chain integrity and anchor state, the decision counts by kind and chokepoint, the rules ordered by friction (warn / deny / exempt / open, with `security` marked as non-exemptable), standing exceptions alive (who, until when, why — expiring ones highlighted), expired and one-off counts, renewals called out as the policy asking to change, the report's signals, and the clone's declared identity (or the fail-closed warning when undeclared). The project directory defaults to the board's own project — climbing to the nearest `.karajan/` when the board runs from a package inside a monorepo — and is remembered per browser; a non-karajan directory is reported as data, never as a 404. Read-only; grants, anchoring and spoken rules arrive with GUI-C.
- **HU Board: grant and anchor from the acta** (GUI-C part 1, KJC-TSK-0773): `POST /api/governance/grant` and `/anchor` run the SAME CLI commands the terminal uses (`kj policy grant --rule --until --reason`, `kj policy anchor`) — nothing re-implemented, so the inexemptable (security class, `defaults.*`) is refused by kj itself and its message travels back as 409. A grant needs rule, until and reason (400) and a declared clone identity (409 with `kj identity set`). In the tab: a grant form listing only the non-security rules, with a confirmation modal (never a native dialog) stating the expiry and that the grant is attributed to the declared identity; an "Anchor now" button on the anchor card whenever the chain is intact and unsealed or stale. Dogfooded on this repo: the first anchor of its decision log was sealed from the button (`.karajan/policy-anchor.json` now tracked).
- **The Sentinel points the user at the board when a card closes** (KJC-TSK-0774): a closing `update_card` (or `kj hu move`) the PostToolUse sees is remembered as a closed card; when the turn then ends green, the Stop hook emits a system message naming the closed card(s) and where to look — the board URL when it runs (`~/.karajan/hu-board.pid` alive), or `kj board start` when it does not — then forgets them, so a quiet turn stays quiet. The playbook adds the same line to the definition of DONE, belt and braces.
- **HU Board: speak a rule from the acta** (GUI-C part 2, KJC-TSK-0773): `POST /api/governance/rule {text, apply}` runs `kj policy add <text>` — the engine translates the sentence into the closed vocabulary and prints the diff; ONLY `apply:true` adds `--yes`. In the tab: a sentence box with **Propose** (shows the diff kj would write, nothing lands) and **Apply** (board modal first, then the same command with `--yes`, then the acta re-renders). Empty text is 400; kj's refusal comes back as 409 with its message.

### Fixed

- **`@karajan-family/governance` 0.1.1 declares `js-yaml`** (KJC-BUG-0149, field report from tribbu-atlas installing the console outside the monorepo): the kernel imported `js-yaml` without declaring it; the monorepo's hoisting hid the gap, a standalone install resolved `js-yaml@5` (ESM, no default export) and the console did not start. Declared as `^4.2.0`, and a test now checks that every publishable family package declares every bare import it makes — the monorepo can no longer hide this class of bug.
- **Board-sync gate: the merged PR's card comes from the PR's head branch, and the board escape opens the push too** (KJC-BUG-0148, KJC-BUG-0147, found live the morning after the gate shipped): a `gh pr merge` issued from another card's lane pinned the pending move on the card of the CURRENT branch — moving the right card never cleared it, and the wrong card (still in development) was locked out of commit and push. The PostToolUse now reads `headRefName` from the same `gh pr view` call it already makes to confirm the merge, and falls back to the working-tree branch only when gh returns nothing (marked `head: unknown`). And `KJ_ALLOW_BOARD=1` now covers `git push` like it covers `git commit`: a multi-PR card is a legitimate implementation plan, and the same conscious, recorded escape opens both. Still open in 0147: the escape prefix is silently ignored when the quoted command text contains parentheses.
- **A release branch no longer manufactures a phantom card the gate then demands you move** (KJC-BUG-0154, lived through while merging this very release's PR — it shipped in 4.22.0 because the publish ran after its merge): `CARD_REF_RE` matched "release-4" inside `chore/release-4.22.0` at the dot's word boundary, so the board-sync gate recorded a pending move for the card "RELEASE-4" — which exists on no tracker — and the Stop gate blocked the turn demanding the impossible. A negative lookahead keeps any version tail from reading as a card. And the second half is worse than the first: `kj hu move RELEASE-4 done` answered `HU "RELEASE-4" not found` and STILL cleared the pending, because the clear only rejected outputs containing error/fail — a move that moved nothing could discard a legitimate pending without touching the tracker. "not found" now counts as failure. Both halves proven red before the fix; an unmakeable violation is exactly what teaches escapes (KJC-PCS-0082).
- **Escape prefixes survive quoted text, and an ignored escape says so** (KJC-BUG-0147 (a)): `KJ_ALLOW_X=1 cmd` only counts on a SIMPLE command, and the simplicity scan rejected `;|&()` anywhere — including inside quotes, so every Conventional Commit message (`fix(scope): …`) silently disabled the escape. The scan now understands quotes: single-quoted text is literal, double-quoted text still rejects `$` and backticks (they expand), backslash escapes are honoured, an unclosed quote is unverifiable. And when the prefix is present but the command is not simple, the Sentinel now says it — `KJ_ALLOW_X=1 presente pero IGNORADO … contiene "|"` — instead of failing with the unrelated gate message.

## [4.21.0] - 2026-08-21

### Added

- **Identity lock — every clone declares who works it, and the method refuses any other account** (epic KJC-PCS-0079, ADR 0005, PRs #1488-#1493): born from a real incident — one `gh` call without an explicit account switch posted as a client account on this public repo, and the rule that would have prevented it lived only in the agent's memory. Now `kj identity set` binds a CLONE (per developer, `.karajan/identity.local.yml`, never tracked) to a gh account and a git email — captured at `kj harden`/`kj env install` only with a human confirming (headless runs declare the pending step, they never bind blindly: the very first `--yes` capture bound a clone to an account another session had switched to). **Tier A** (Sentinel): `gh`, `git push` and every commit-authoring git command (`commit`, `tag`, `merge`, `rebase`, `cherry-pick`, `am`, `revert`) are denied BEFORE running under any other account — gh session read from gh's own `hosts.yml`, authorship resolved by `git var` under the command's own environment with its global options forwarded verbatim (`-C`, `-c`, `--git-dir`, `GIT_*_EMAIL`, `GIT_CONFIG_*`, `--author`), wrapper shells (`bash -c`, `sudo -u`, `eval`), `$()` and backticks scanned inside. **Tier B** (hooks, any host): pre-commit checks authorship, pre-push the gh session; undeclared = advisory. Undeclared under the Sentinel = fail-closed; `KJ_ALLOW_IDENTITY=1` is the audited escape; never auto-switch. Migration: run `kj identity set` once per clone (the next `kj harden` asks).
- **Board-sync gate — a merged card must be moved in the tracker before anything advances** (KJC-TSK-0765, PRs #1494-#1498): the user's rule after four merged cards sat In Progress: *it cannot advance if it is not registered*. A merge the Sentinel sees (state-verified through `gh pr view`, because `gh` prints nothing under a tool call) leaves the branch's card PENDING; `git commit`, `git push`, `gh pr create`, another merge and the end of the turn are refused — naming card, PR and remedy — until the REAL tracker call clears it (`mcp__*__update_card` with a closing status, or `kj hu move`; never a promise in prose). Three gaps found in its first hour of production and fixed the same night: gh silent outside a TTY, PostToolUse wired only for edit tools (Bash and MCP now wired), and the escaped MCP response shape. It governed the card of its own creation on its first real merge.

## [4.20.1] - 2026-08-20

### Fixed

- **`kj start` finally sees the project it is standing in** (KJC-BUG-0145, PR #1486, field report on issue #1471 after testing 4.19): `loadConfig` never sets `projectDir`, and `kj start` handed that `undefined` straight to the sweep — every collector is wrapped in `safe()`, so `readdir(undefined)` failed silently and ANY project read as "new — no source code found, 0 commits". The 4.19 deep-scan fix was correct and never executed; its tests injected collaborators and never walked the real CLI path. Two layers now: `kj start` resolves the directory from `cwd` like every other command, and the sweep REFUSES a missing root instead of returning an empty project. Locked by an on-disk integration test with the reporter's exact inventory, and verified through the real CLI: `legacy — code present but neglected`, harden advisory included.

## [4.20.0] - 2026-08-20

### Added

- **kj governs infra like it governs app code** (epic KJC-PCS-0078, INF-A/B/C, PRs #1480-#1483, born from the demo-kind field case): the method was language-agnostic but three concrete pieces still assumed application code. **The Sentinel counts infra as source** (INF-A): editing `.tf/.hcl/.yaml/.yml/.sh` or a Dockerfile/Makefile/Vagrantfile now engages card-first, the Stop gate and the push gate exactly like a `.js`, with `*_test.*` files (terratest) classifying as tests. **Infra suites exist** (INF-B): `detectTestFramework` gains an infra tier AFTER app frameworks (a mixed repo keeps its framework; a stray yaml never classifies) — `*.tf`/`terraform/` → terraform validate, `Chart.yaml` → helm lint, `kustomization.yaml` → kustomize build, `ansible.cfg` → ansible-lint — and the tester brief orders the suite FIRST with checkov chained as the additive deep scan (review catch: the basic suite always runs; a missing checkov degrades DECLARING it, a missing suite tool is a fail with the install command, never a fake green). **The audit speaks infra** (INF-C): `kj audit --security` runs checkov — one tool covering terraform/k8s/helm/kustomize/ansible/dockerfiles — through the same best-effort channel as semgrep: not-applicable declared on app-only repos, missing binary declared with `pipx install checkov`, non-zero-with-JSON rescued, and it runs in the securityOnly pass because misconfigs ARE security surface.

### Fixed

- **Two more field findings from the same reporter, fixed the same night** (issues #1471/#1465): `codex exec` >= 0.146 removed `--full-auto` — kj's auto-approve now sends `--sandbox workspace-write` with a legacy retry for old CLIs (KJC-BUG-0143, PR #1478; never felt locally because the panel's coder is claude). And `kj start` passed the Claude-only `haiku` default to agy: `BaseAgent.getRoleModel` now drops cross-FAMILY models per provider at the chokepoint (agy belongs to the gemini family; aider/opencode/copilot are multi-model hosts and stay unfiltered — a nuance that broke 8 legitimate tests before it was learned and locked) so no agent ever receives another vendor's `--model` (KJC-BUG-0144, PR #1479).

- **The escape hatch existed only in the error message** (KJC-BUG-0142, PR #1476, found live while releasing v4.19.0): every Sentinel deny advertises its escape as a command prefix (`KJ_ALLOW_X=1 cmd`), but every check read `process.env` of the HOOK process — inherited from the host, unreachable from a command prefix. Tests passed because they inject env into the hook's spawn: exactly what production never does. The release gate deadlocked itself: the landing item only turns green after the deploy, and the deploy was blocked by the same gate. Now the prefix works — for a SIMPLE command only: any `; | & $ ( )` backtick or newline refuses the textual escape (in a chain the shell prefix would not reach later commands — review catch), assignments must be literal, and the env route stays. Self-protection runs before the helper and security findings remain escape-less. Two codex catches absorbed; the third round (quoted assignment values) went to arbitration and solomon ruled for the brain: fail-closed narrowness is the design — wrong quoting grants wrongly, wrong rejection just falls back. Its first two production uses were this very release's deploy and cleanup.

## [4.19.0] - 2026-08-19

### Added

- **Green is not proof — the mutation pre-gate joins the method** (MUT-A, KJC-TSK-0716, epic KJC-PCS-0072, PRs #1466/#1468): a suite can be green with weak asserts; surviving mutants prove it. Opt-in (`method_gates.mutation: warn|block` — mutation costs minutes, it never runs undeclared), STAGED-only (never in the pre-commit, never with `--range`: the scope is the INDEX via `getDiffScope staged` — the naive `since: HEAD` would have produced an EMPTY range and mutated nothing, a review catch that got worse under verification). `warn` ships survivors as an advisory inside the reviewer's task (the sonar channel); `block` rejects BEFORE spending a reviewer token, listing each survivor with its remediation; an unavailable tool or malformed report degrades SAYING which net is down. The playbook and the tester brief now ORDER it: run `kj mutate --since` after green and before review. SPD-A has its base metric.
- **Two field findings fixed the same day they were reported**: `kj agents --help` now enumerates its subcommands (list|set), the 9 assignable roles and the 9 providers with examples — SELF-FED from the real constants so it cannot drift again (KJC-TSK-0755, PR #1467, found by Pedro Amador on his Mac); and the `kj advanced` policy line stopped claiming "PL-A: modo warn" two days after the policy grew teeth (PR #1464).
- **`kj doctor` declares its guarantee level per host — kj never fakes a supervision it cannot apply** (KJC-TSK-0756, PR #1472, field finding: "kj feels too coupled to claude — it should be more agnostic"): the coupling is not a bug, it is a DISCLOSED guarantee gradient. A pure `guaranteeLevel()` derives, from observable facts only (detected host, wired harness, declared policy, seeded CI workflow), which of the three tiers are ACTIVE right now: A tool-time (Sentinel — Claude Code only, the sole host with synchronous hooks), B commit-time (git gates — any host, the FLOOR), C merge-time (CI re-check — any host with the workflow). The doctor prints the three lines with reasons and `--json` carries `report.guarantee` for tooling. Run kj from codex or gemini and it works — and tells you exactly which guarantees you kept and which you gave up.
- **The family scope migration begins — kj no longer hardcodes its own npm name** (MIG-A, KJC-TSK-0751, epic KJC-PCS-0077, ADR 0004, PRs #1461-#1462): executing PRP-0018, everything moves under `@karajan-family` without breaking anyone. Self-references now resolve from the manifest: update-check reads its OWN package name (lazy + legacy fallback — the SEA bundle has no package.json next to the module) with URL-ENCODED registry paths (a scoped name carries `@` and `/`), verify-pack validates whichever tarball it is given, and the policy workflow template pins name AND version. `scripts/dual-publish.mjs` ships the SAME content under both names: in-place name swap with byte-for-byte restore in `finally` (crash included), refuses to rename blindly, merges `publishConfig` instead of clobbering it, and verifies with the SAME verify-pack — proven live: `@karajan-family/code@4.18.0 installs clean and runs`. With this release the scoped first-publish happens: `@karajan-family/code` ships the same bits as `karajan-code`. An architecture test locks the literal out of the critical paths. Three cross-AI review catches absorbed with regressions.

### Fixed

- **`kj start` no longer calls an infra project empty** (KJC-BUG-0141, PR #1473, field finding on a demo-kind project: "maturity: new — no source code found" with a backend/ full of code): the source count leaned on the display tree (`maxDepth = 2` — anything under `backend/app/…` was invisible) and `CODE_EXT` only knew application languages (a kubernetes/terraform/shell project counted ZERO source). The sweep now runs its own deep scan (depth 6, ignores build dirs and tests) and infra IS source: `.yaml/.yml/.tf/.hcl/.sh` plus Dockerfile/Makefile/Vagrantfile count, with the `infraFiles` signal exposed. Fail-soft: if the scan cannot run, the tree count remains the fallback. Windows separators normalized (review catch).
- **The lane guard learned what a quote pair is** (KJC-BUG-0140, PR #1469): the quoted-path-with-spaces heuristic matched an ILLUSION — the closing quote of a commit message, a literal redirect (contributing the slash and spaces), and the opening quote of the next string — denying the method's own standard flow. Found by the Sentinel gating ITS AUTHOR minutes after being dogfood-installed in kj's repo: six denials, a Stop-gate refusal and a self-protection block later, the fix landed through the very gates that were blocking it. The scanner now walks REAL quote pairs and evaluates whole shell tokens (adjacent spans concatenate; mid-token quotes and post-redirect quotes still deny; escapes touching a quote or blank are opaque; an unclosed quote denies) — with special characters built via `fromCharCode` and explicit comparisons, ZERO escaping in the template: the double-escaping had misled four review rounds (solomon dismissed the first with empirical verification of the generated artifact; the second arrived labeled security — non-arbitrable by doctrine — and instead of fighting the label, the structural fix made the code impossible to misread; the fifth round approved).

## [4.18.0] - 2026-08-19

### Added

- **The renewal is the signal** (GOV-E, KJC-TSK-0750, PR #1459): `kj policy grant` counts prior grants on the same rule — expired ones INCLUDED, those are the sedimentation — and from the 2nd on says it to your face: "Nth grant on this rule — an exception that renews is no longer an exception: change the policy through its own channel (PR)". Informative, never blocking. Born from a LinkedIn reader's observation: the audit failure is not the unapproved exception, it is the impeccably-approved one from 3 years ago that nobody closed — by then it IS the process. In Karajan expiry is executed by the system (GOV-B) and renewal surfaces as a signal (this).

- **PL-C closes the policy triangle — tier C in CI, one threshold, spoken rules, acting roles** (KJC-TSK-0735, epic KJC-PCS-0074, PRs #1454-#1457): the last tier of ADR 0001 lands. **Tier C**: `kj policy check` gains `--range` (in CI there is no staged diff — the SAME engine evaluates base...head) and `--strict` (exit 2 naming the rule on any `enforcement=deny` violation; warn keeps informing without blocking), and `kj harden` seeds a `kj:managed` `kj-policy.yml` workflow ONLY where the project declares a policy — merge-blocking, actions pinned by SHA, and the npx fallback pinned to the exact kj version that ran harden, never `@latest` in CI (supply-chain catch). **Single threshold source**: when the policy declares the `net_lines_added` invariant, its `max` is THE number — `kj review`'s pr-size warning/block reads it (naming the source), and this repo's shrink-budget CI extracts it from the policy file FAIL-LOUD (a gate that cannot find its threshold refuses to guess). **`kj policy add "<spoken rule>"`**: an agent translates to the closed vocabulary, `parsePolicy` validates the merge twice — the untranslatable is REJECTED, never invented — and the proposed diff never touches disk without explicit `--yes`. **Acting roles in tier A**: the PreToolUse gate evaluates with `KJ_POLICY_ROLE` and claude subprocess runners seed it from the orchestrator's `task.role` — which is AUTHORITATIVE: a manipulated task env cannot spoof the role (privilege-escalation catch, locked by regression). README's Guarantee levels now tables the three tiers per host; tier B remains the guarantee floor. Five cross-AI review catches absorbed across the four PRs, plus two CI-caught contracts (the SEA bundle's eager version read, the dynamic-import budget).

- **`kj policy anchor` — temporal anchoring without a blockchain** (GOV-C2, KJC-TSK-0749, PR #1450): born from the "which blockchain fundamentals belong here?" triage — integrity cryptography came in, adversarial decentralization stayed out. The command verifies the ENTIRE decision-log chain (a broken chain screams and refuses to seal; a log with fewer entries than the last seal means truncation after anchoring — no re-seal) and writes `.karajan/policy-anchor.json` `{head, length, ts}`, a TRACKED file: committing it anchors the log in git history, so rewriting yesterday's log requires rewriting yesterday's repo.
- **`@karajan-family/governance@0.1.0` published — the kernel leaves the nest** (GOV-D, KJC-TSK-0748, PRs #1451-#1452): the governance kernel is a real npm package under the family scope (the `karajan` scope was taken; the `karajan-family` account owns it). kj consumes it as a REAL dependency (karajan-core pattern: local workspace in dev, registry in the published tarball); every import — source and tests — goes through the package's public export map, and the tarball whitelist bridge is retired: **verify-pack proves kj's tarball resolves the kernel FROM THE REGISTRY**. With this, epic KJC-PCS-0076 closes complete: extraction (GOV-A), expiring exceptions (GOV-B), chained decision log (GOV-C + C2), publication and real consumption (GOV-D). 0.x on purpose: 1.0 is an API-stability promise that waits for the second family adapter (rag) to stop bending the interface.

- **Chokepoint decisions leave a tamper-evident trail** (GOV-C, KJC-TSK-0747, epic KJC-PCS-0076, PR #1448): the process-evidence gap from the auditability diagnosis closes — until now only RESULTS (verdicts) and exceptions left a record; the gate's DECISIONS did not. The kernel's `recordDecision` seals every entry with `prev` = sha256 of the previous line: `.karajan/policy-decisions.jsonl` is append-only and HASH-CHAINED, so editing, deleting or reordering an entry breaks the chain verifiably (`verifyDecisionChain`) with no infrastructure beyond the file itself. Each record cites `policy_hash` (sha256 of the raw policy.yml — null when there is none: the decision says so rather than inventing it) and `artifact_hash` (the diff). What gets sealed: every deny with its rule_ids, every exemption, and the allow of the COMMIT chokepoint (`--check`, what the pre-commit calls). What does not: tool-call allows and `--staged` allows — volume and noise are not evidence, and a test locks that choice.

- **Standing exceptions — permanent, expiring, and granted with evidentiary weight** (GOV-B, KJC-TSK-0746, epic KJC-PCS-0076, PRs #1445-#1446): the kernel's Exception object gains its full shape. `scopeKind: puntual | permanente` (closed vocabulary): puntual — the effective type of every legacy record — binds to the artifact hash (implicit expiry); **permanente requires `expiresAt` in STRICT ISO-8601** (bare `Date.parse` swallowed ambiguous local dates), and `evaluateGate` honors standing exceptions while they LIVE with an explicit `now` from the evaluator — expiry is the rule, not a suggestion: expired means the gate closes again on its own. `kj policy grant --rule --until --reason` records the grant with the reader's evidentiary model complete: identity (now carrying `grade: declarada` — git+os is attribution, not authentication), the exact rule, the justification written at the moment, and the mandatory expiry. **Non-exemptable stays non-exemptable at grant time too**: `defaults.*`, any `class: security` cap and an unverifiable policy are refused — no reason accepted. The jsonl loader is tolerant (a corrupt or non-object line is discarded COUNTED, never breaking the gate) and `kj review` prints every standing exemption with its expiry and justification. Five cross-AI review catches absorbed, each locked as a regression test.

- **The governance kernel is born — `@karajan/governance`** (GOV-A, KJC-TSK-0745, epic KJC-PCS-0076, ADR 0003, PRs #1441-#1443): the policy engine, the decision gate and the exception record are not code-specific — they are a governance kernel for AGENT ACTIONS, and now they live as a family package (`packages/governance`) with karajan-code as its FIRST CONSUMER, not its owner. The kernel knows exactly three abstract concepts: Policy (closed fail-loud vocabulary with a non-exemptable subset), Decision (deterministic, local, no network, no LLM) and Exception (identity + exact rule + justification written at the moment + artifact hash); an artifact is only an identifiable, hashable reference. The kernel contains ZERO references to git, diffs, harness tools or karajan paths — the boundary criterion (ADR 0003): "names a harness tool, a project path or a git command → adapter; evaluation, vocabulary or decision flow → kernel". The non-exemptable defaults are now DATA each consumer injects ({id, pattern, message}) and survive even an invalid YAML; in code they protect the Sentinel's supervisor files, and a kernel-only test proves an invented domain (sealed ledger records) governs with its own defaults. The adapters keep the exact PL-B surface — 332 policy/review/harden tests pass without changing a single assertion, the proof of zero functional change. The kernel travels INSIDE kj's tarball (hu-board pattern: workspace + files whitelist + relative imports) until the npm scope exists; then GOV-D flips it to a real dependency. Future consumers, by schema: rag (index/collection — privacy as non-exemptable policy), watch (trigger — reusing the kernel's shell matcher), radar (source/publish).

- **Policy enforcement — deny at every chokepoint, exceptions with evidentiary weight** (PL-B, KJC-TSK-0734, epic KJC-PCS-0074, ADR 0001, PRs #1435-#1439): the declarative policy grows teeth. Each rule and invariant now carries `enforcement: warn | deny` (default `warn` — PL-A behavior intact) and optionally `class: security`, both closed-vocabulary and fail-loud. The rules the Sentinel's PreToolUse hook used to hardcode (`.claude/settings.json`, `.karajan/hooks/**`, `.karajan/harness/**`) now live as EMBEDDED ENGINE DEFAULTS — `class: security`, `enforcement: deny`, evaluated before any role cap, and no project policy can weaken them. Enforcement lands at all three chokepoints: `kj review --staged` AND `--check` reject deny-violations deterministically before spending a reviewer token (the pre-commit inherits the teeth with no hook regeneration), `kj solomon` refuses to arbitrate security-class findings or an invalid policy (fail closed — an empty result from a load error can never mean "go ahead"), and the PreToolUse gate delegates to `kj policy eval --strict` when `.karajan/policy.yml` exists, fail-closed on every non-zero outcome including an unexecutable kj (no gate goes down silently). The escape follows the evidentiary model a reader of the policy-layer discussion sharpened: the value of an exception is WHO approved it and with what context — `KJ_ALLOW_POLICY=1` only exempts with `KJ_POLICY_REASON` written AT THE MOMENT, recorded append-only in `.karajan/policy-exceptions.jsonl` with git+os identity, the exact rule, the justification, and the diff hash (scope = that exact diff, so expiry is implicit); `class: security` has no escape and no arbitration, full stop. Forged through 4 cross-AI review catches, each locked as a regression test.

## [4.17.0] - 2026-08-18

### Added

- **Policy as code — `kj policy` and the deterministic policy engine** (PL-A, KJC-TSK-0733, epic KJC-PCS-0074, ADR 0001, PRs #1429-#1432): rules stop being requests. `.karajan/policy.yml` declares per-role capabilities (`write` allow/deny globs, `shell` command patterns) and invariants (`diff-threshold`) in a CLOSED, fail-loud vocabulary — anything the engine cannot enforce is a LOAD ERROR, never a silently dead rule (unknown kinds/keys, malformed shapes at every level, unsupported versions, an unreadable file ≠ "no policy"). Evaluation is pure and deterministic: deny wins, an allow-list makes the outside a denial, unverifiable targets deny (missing paths, traversal, absolutes without root, unknown tools for declared roles), and the shell matcher survived a full adversarial review cycle — quote-aware tokenization, launchers peeled (PATH-altering assignments opaque), substitution/redirections/backgrounding/escapes/expansion all opaque-therefore-denied. `kj policy check` warns on the staged diff (PL-A never blocks); `kj policy eval --strict` exits 2 on deny — the contract PL-B's hook adapters will consume. Forged by ~23 cross-AI review catches and two solomon rulings, each one a regression test.

- **The landing joins as `apps/landing` — the family monorepo is COMPLETE** (MONO-3, KJC-TSK-0740, epic KJC-PCS-0075, PRs #1423/#1424): 374 commits of landing history under the monorepo, mailmap extended to cover a client-corporate authorship email, and the epic's promise cashed the same hour — the v4.16 landing update that had waited 8 days for an external session (karajan-landing#189) shipped as a normal in-repo PR plus deploy, turning `kj release check`'s landing probe green. From now on a kj release updates its landing in the same repository: the release→landing delegation dance is dead. All four family source repos stay frozen as immutable references. (MONO-2, KJC-TSK-0739, PRs #1420/#1421, merge commits): `packages/watch` (38 commits, tags `watch-v0.1.0…0.6.0`) and `packages/rag` (full history, tags `rag-v0.1.0…1.5.0`) with email-only mailmaps — every imported authorship signs with the noreply address. kj's npm resolution of karajan-rag is UNTOUCHED (verify-pack green on the fusion branch; workspace-linking is a follow-up). New `imported-history` label skips ONLY commitlint on fusion PRs — an imported repo keeps its era's messages, rewriting them would falsify history. Source repos stay frozen, not archived.
- **karajan-radar joins the monorepo as `packages/radar`** (MONO-1, KJC-TSK-0738, epic KJC-PCS-0075, PR #1418, merge commit — never squash): 92 commits of full history rewritten under the package path (`git log packages/radar` tells the whole story). The privacy gate paused the first attempt — the source repo was PRIVATE — and the resolution set the pattern for the family: full private-history audit (clean blobs, zero secrets, zero personal emails in content) plus a mailmap in the filter so the 32 commits authored with a personal email enter public history under the noreply address; the source repo stays private as the immutable original-SHA reference instead of being published. Radar keeps its own toolchain (root eslint/prettier ignore it) and the injection-guard workflow learns to exempt a sibling LLM product's legitimate surface — its own scanner, prompt templates, corpus and test fixtures — under the same doctrine as the existing exclusions.

- **Lane boundary — each session mutates only ITS worktree** (MONO-0, KJC-TSK-0737, epic KJC-PCS-0075, ADR 0002, PR #1416): the Sentinel's PreToolUse gate now denies Edit/Write/Bash mutations into a SIBLING worktree of the same repo (lane identity = worktree toplevel; repo identity = git-common-dir), before the damage — reads stay free and the `KJ_ALLOW_CROSS_LANE=1` escape is audited. Forged by 12 cross-AI review rounds and two solomon arbitrations: symlink canonicalization, not-yet-existing subdirs, absolute/dot-relative/bare/`~` token scanning with no cap, glued redirections, conservative denial of `cd`/`pushd` in mutating commands, command substitution and quoted-paths-with-spaces, and `$VAR` tolerated only in own-toolchain runner segments. This is the safety prerequisite for the family-monorepo migration (two sessions colliding on one tree was a real incident).

## [4.16.0] - 2026-08-10

### Fixed

- **Disabled sonar rules are ALL ignored now** (KJC-BUG-0139, PR #1411): `buildScannerOpts` declared `sonar.issue.ignore.multicriteria` once per rule — last definition wins, so with the default `[S1116, S3776]` only S3776 was really ignored and S1116 kept reporting on every kj scan despite being "disabled". The list property is now declared once with every entry; the old test locked the broken shape and was rewritten to the real contract.
- **The project's own Sonar quality gate is OK again** (KJC-TSK-0540, PR #1410): new-code period fixed to 30 days (it inherited PREVIOUS_VERSION with no version ever sent — "new code" accumulated months), real coverage uploaded (83.8%; the old red numbers were scans without lcov), the 15 real in-period violations fixed in code, and the 4 in-period security hotspots individually reviewed as SAFE with written justification.

- **Direct-action installs skip lifecycle scripts** (KJC-BUG-0099, PR #1405): the Brain's `run_command` ran allow-listed dependency installs with lifecycle hooks live — an autonomous `npm install` was arbitrary code execution via any compromised dependency's postinstall. The allow-list still names the intent; execution appends the ecosystem's skip flag (npm/pnpm/yarn `--ignore-scripts`, composer `--no-scripts --no-plugins`); ecosystems without package hooks run untouched.
- **verify-pack's pnpm smoke is isolated from the host repo** (KJC-BUG-0135, PR #1406): `npm run` leaks `npm_config_*` into the child env and pnpm maps those onto its own config — on 7-aug it re-anchored to the repo itself, converted `node_modules` to pnpm layout (wiping native bindings) and let simple-git-hooks overwrite `.karajan/hooks`, silently disarming the local review gate. The smoke now runs with a scrubbed env and a pinned `--dir --ignore-workspace`, and a tripwire fails the gate loudly if any pnpm artifact appears at the repo root — never a green over a contaminated tree.
- **The anti-delete hook fails closed** (KJC-BUG-0095, PR #1407): the installer wrote a bare `kj-trash hook` line into Claude Code's global PreToolUse — with the bin off PATH (nvm switch, reinstall) the net went down without notice. The installed line now blocks the tool call naming the downed net and the remedy; legacy lines upgrade in place on reinstall, deduplicated.

### Added

- **card-first verifies liveness against the declared tracker** (KJC-TSK-0732, issue #1371, PRs #1402/#1403): on planning-game/external backends the gate no longer settles for a card-shaped branch reference — with `board.verify_cmd` declared (the user's own adapter: their CLI/MCP wrapper, credentials never enter kj; `{ref}` substituted, `{exists, live, status}` JSON out) the referenced card is verified ALIVE in the real tracker. Dead or invented refs get the same treatment as "no card"; unverifiable degrades honestly to the branch-ref level and the gate SAYS SO — a pass by reference never reads as a tracker-verified pass. Short per-adapter cache (definitive verdicts only), 4s timeout, ref inert by construction. card-first now means the same thing on every backend.

## [4.15.0] - 2026-08-08

### Added

- **The governed tournament — `kj tournament` → `--score` → `--judge` → `--crown`** (epic KJC-PCS-0073, KJC-TSK-0723/0724/0725, born from the Orca analysis: "fan one prompt across N agents, compare, merge the winner" — with a human eyeballing diffs; here the method chooses): fan the SAME task out to N coders in N isolated worktree lanes (`task.cwd` forwarded to every adapter; per-lane evidence: diff with intent-to-add, suite result, agent log, metadata; one lane's failure never sinks another) → a **deterministic zero-LLM scoreboard** (red suite eliminates; net LOC and tests parsed with exact-header diff parsing; mutation with honest degradation — a null never becomes a hidden penalty; the ranking rule is lexicographic and PRINTED with the result) → a **cross-AI judge** that chooses among survivors (a participant never judges its own tournament; only first place crowns; tie or winner-disagreement escalates to solomon with both positions; the LLM verdict is untrusted input — hallucinated coders fail loud) → the **crown**: the winner enters through the NORMAL door — real cross-AI review of its exact staged diff, verdict bound to the sha256, commit through the pre-commit gate; a rejected review aborts the coronation, because winning the tournament earns a candidacy, not a bypass. Losers keep their full dossier. The complete cycle ran LIVE on day one, coronation included. Ten legitimate cross-AI review rejections hardened the epic along the way.

### Fixed

- **Generated workflows pin actions to commit SHAs** (KJC-BUG-0136, issue #1374): the 5 actions in `kj harden` templates (checkout, setup-node, setup-python, setup-go, setup-php) are pinned to full commit SHAs with the version as a comment — `PINNED_ACTIONS` is the single source with the bump recipe, and a lock test forbids mutable `@vN` tags structurally. A mutable tag lets its owner run code in the CI of every hardened repo, with access to its secrets; `kj audit --security` said so about kj's own output, and now a freshly hardened project comes out clean. Managed workflows refresh themselves on the next `kj harden`.
- **Lint config and CI gate only when the tool exists** (KJC-BUG-0137, issue #1357): one principle for both halves — kj never generates a demand it didn't leave satisfied. `eslint.config.js`/`.prettierrc.json` only seed when the tool is actually installed (declared dep or resolvable bin, monorepo-aware); otherwise the report says `omitted` with the install command. And the quality workflow drops `--if-present`: a project WITH a lint script gets a step that ENFORCES; one without gets no step — same contract as the local hook. No more decorative configs, no more gates that disarm themselves silently.
- **Diff clipping is declared as the pipeline's own** (KJC-BUG-0134, issue #1381): the bare `[TRUNCATED]` marker inside the diff body made reviewers blame whichever file the cut landed in — blocking issues against complete, untouched code, each costing a solomon round. Shared `diff-clip` module for both prompt paths: cut on a line boundary, omission declared OUTSIDE the diff as kj's own note (how many lines exist unseen, the cut is kj's not the author's, do not reason about completeness). The bare marker is now forbidden by test.
- **A file split is not a coverage deletion** (KJC-BUG-0138, issue #1364): 4 of 13 pure-refactor PRs were falsely rejected for "deleting tests" whose replacements sat in the SAME diff — and kj's own method pushes toward that refactor. Deterministic zero-LLM pre-analysis correlates significant removed lines reappearing verbatim among another file's additions (multiset, exact headers, trivial lines excluded, conservative thresholds) and hands the reviewer the correlation as a pipeline note: moved is not deleted.

## [4.14.0] - 2026-08-07

Minor. **The panel never runs dry** — born from a real outage: codex exhausted its weekly quota mid-card and the whole arbitration panel collapsed with it (gemini retired, the local model down, copilot conflicted as the disputing reviewer). One day later: quota failover with consent, two new agents restoring the panel, and the lint rot that was hiding in the unwatched corner.

### Added

- **Kimi Code and Antigravity CLI as the eighth and ninth built-in agents** (KJC-TSK-0729): `kimi` (Moonshot, free tier — the panel's no-cost reserve) and `agy` (Google's official successor to the gemini CLI retired 2026-06-18, covered by a Google AI Pro subscription — the gemini lineage back in the arbitration panel). Both verified live against their real CLIs (`-p` print modes, JSON parsing, no-tools review discipline, coder-only permission grants); both promoted OUT of the observation census — detecting is not supporting, supporting is. `aider` also joins the quota-failover candidates via env-key auth. And the root fix the agy debut exposed: **a role's model pin belongs to its provider** — switching provider by flag (`--reviewer agy`) now drops the pin instead of shipping codex's model name to a CLI that answers with its model list (second appearance of this bug class in two days; now closed at the overrides layer, with tests). agy's first act: approving the review of its own adapter.

- **Reviewer quota failover — a loud switch or an actionable menu, never a silent failure** (KJC-TSK-0730, born from the real codex weekly-quota outage of 2026-08-06 mid-card): when the configured reviewer's quota is exhausted (classifier over the real error shapes), `kj review` retries ONCE with the first installed+authenticated candidate from a declarative registry (codex, copilot, agy, kimi, qwen, opencode — tier, login command, verified install command, local auth heuristics) that is neither the exhausted reviewer nor the host — warning loudly and telling you how to pin it; with no candidate, it fails with the menu of candidates and their exact login commands. The exhausted provider's model pin never travels to the fallback (its model name means nothing there). `reviewer_options.auto_fallback` (default on) opts out. Every verdict during the outage day — including this feature's own reviews — shipped through it.
- **Observation census of agent CLIs — detecting is not supporting** (KJC-TSK-0728, from the Orca landscape): `kj check`'s AI-surface inventory now also snapshots installed agent CLI binaries (grok, cursor-agent, pi, kilocode, kimi, vibe, rovodev) as `(cli)` entries, so a newly-appeared agent binary trips the same "NEW since last check — approved by you?" drift question; `kj doctor` gains one aggregate `agents:observed` line listing only what was found. Pipeline agents unchanged. Its first real run caught two true drifts on the maintainer's machine.

### Fixed

- **packages/ joins the lint surface — 1124 errors to zero** (KJC-TSK-0543): the card said "21 no-undef errors"; reality was 1124, because `npm run lint` never looked at packages/. Flat-config blocks per environment (node for src/bin, browser CLASSIC scripts for the hu-board dashboard — 132 shared globals declared with a regeneration recipe — vitest for tests), `npm run lint` now covers `src/ packages/` so the rot is structurally impossible, and the 17 real findings fixed (dead imports, a dead function, a missing `Error` cause).

## [4.13.0] - 2026-08-05

Minor. **The program rules, the agent thinks** — the deterministic brain of v3 is reborn as a supervisor with real, synchronous authority over the agent: the Karajan Sentinel. Born from a field case: an agent that narrated the rules while skipping the gates. v3 had authority without intelligence; v4 intelligence without authority; the Sentinel separates the powers.

### Added

- **Karajan Sentinel — the rule fires before the damage** (KJC-TSK-0714): the PreToolUse gate goes stateful. Editing a source on the base branch or on a branch without a card ref blocks with the exact remediation (`kj hu add` / `feat/<CARD-ID>` branch); `npm publish`/`firebase deploy`/`gh release create` with a red `kj release check` block listing the failed items; `git push` with open method violations blocks. Read-only tools are never wired; every honored `KJ_ALLOW_*` escape is recorded as an auditable event. Shared `sentinel-lib.mjs` is the single source for all sentinel scripts.
- **Karajan Sentinel — it cannot be dismantled silently** (KJC-TSK-0715, closing epic KJC-PCS-0071): layered self-protection — edit tools over `.claude/settings.json`/`.karajan/hooks`/`.karajan/harness` block with NO agent escape; any Bash naming those paths is denied outright (write-verb blocklists are bypassable; reading is what Read/Grep are for); shell indirection is caught by **`kj sentinel verify`**, whose root of trust is the installed kj package itself — never the project tree — invoked by the Stop gate on every turn end: tampered scripts block the turn, `kj harden` restores. Every escape surfaces: `systemMessage` summary when the turn ends green, and a sentinel-escapes section in `kj report` (project dir derived from the session snapshot). The design was hardened by four legitimate cross-AI review rejections in a row — the method reviewing its own supervisor.
- **Karajan Sentinel — the turn cannot end red** (KJC-TSK-0713, epic KJC-PCS-0071, born from the field critique *"with an agent as brain it is impossible to be strict about the rules"*): a deterministic supervisor (zero LLM) wired by `kj harden` into the harness's synchronous hooks. A PostToolUse hook records the method state of the session (sources edited vs tests touched, `KJ_ALLOW_*` escapes used) and a **Stop hook blocks the agent from ending its turn while method violations are open** — sources edited on the base branch, a branch without a card ref, code without a single test touched — each block stating the exact violation and its remediation. `kj sentinel status` inspects the state; fail-open (recorded) on corrupt state or after 3 unresolved blocks, so a sentinel bug never hangs a session. v3 had authority without intelligence; v4 intelligence without authority; the Sentinel separates them: the program rules, the agent thinks. Claude Code only by decision (ADR): to guarantee a harness that controls the LLM, use Claude as the host — Claude writes, Codex reviews, gemini retired.

## [4.12.0] - 2026-08-03

Minor. **Memory is the reminder; the check is the guarantee** — the release checklist stops depending on anyone (human or AI) remembering it.

### Added

- **`kj release check` — the release checklist made verifiable** (KJC-TSK-0712, born from the user's critique: *"whatever you note down, you eventually ignore it"* — a note loses salience; a check fails RED with the exact list): generic checks for any karajan project — manifest version vs the CHANGELOG's TOP section (Unreleased promoted?), no tag ahead of the manifest, privacy scan of the exact publishable file set — plus the project's own declarative items in `release_check.items` (`file_contains` with `{version}` interpolation, or any `command` with exit-0 semantics), written once by the agent during setup and evaluated forever after. Completes the per-project triad: commit check (pre-commit gate), PR check (harden CI), release check. First live run caught its first real finding within a minute — a wrong URL in this very repo's landing item.

## [4.11.0] - 2026-08-03

Minor. **The toolbox decides** — agents use what is in front of them, so the RAG becomes a native MCP tool and the board becomes a question. Two installs-that-listen born from the same field week.

### Added

- **The board is a question, never a silent default** (KJC-TSK-0709, field case 2026-08-02: an install defaulted to hu-board with the user's Planning Game MCP sitting configured and detectable): `kj env install` now detects the boards this machine can reach (Planning Game MCP, external boards by MCP mention or conventional token — `LINEAR_API_KEY`, `JIRA_API_TOKEN`…) BEFORE rendering the playbook. Interactive installs ask and PERSIST the choice in `.karajan/kj.config.yml` (asked once, ever); headless installs keep the default but name the alternatives and the exact line to switch. A backend declared in a config file is never asked again — and "declared" now means *written by you in a file*, because the merged config always carries the default and cannot tell a choice from a fallback. Drift caught along the way: the config schema never learned the `external` backend that shipped in v4.5.0 — a declared `state_backend: external` failed validation ever since. Fixed.

- **The RAG becomes a native tool** (KJC-TSK-0711, field case 2026-08-03: agents in karajan projects grepped code by hand because the RAG was only "a Bash command a text line told them about"): `kj env install` now wires kj's RAG-only MCP server (`kj-rag-mcp`, ships with the package) into the project's `.mcp.json` — merged, idempotent, user entries preserved, invalid JSON untouched. Agents use the tools in their toolbox, so the official path (`kj_rag_query`) is now cheaper than the grep shortcut — the same shadow-AI principle the privacy epic borrowed. The playbook names the native tool alongside `kj rag query`.

## [4.10.0] - 2026-08-02

Minor. **Nothing personal ships** — every outbound boundary (staged diff, npm tarball, any build output) now audits for personal data and hardcoded secrets before it leaves the machine. Born from a real incident: personal emails published on a landing page inside release notes. Epic KJC-PCS-0070.

### Added

- **The tool gate: rules imposed at tool time** (KJC-TSK-0710, from proposal KJC-PRP-0013 — suggested by the offending agent itself: *"instructions weren't enough; the environment must impose them"*): `kj harden` (standard+) now writes a PreToolUse hook script and wires it into the project's `.claude/settings.json` (merged, never clobbering the user's own settings). `Write` over an EXISTING file blocks with "use Edit" (`KJ_ALLOW_WRITE=1` escapes); a Bash command that reserializes whole JSON files to disk (`json.dump` + write signal) blocks with "make targeted edits" (`KJ_ALLOW_REWRITE=1`). A new rung under the commit gate: the rule fires when the tool is invoked, not when the agent remembers it. Fails open on garbage input — a gate bug never bricks a session. Claude-only v1; the abstraction arrives with the second host that supports tool hooks.
- **Privacy onboarding rides `kj env install`** (KJC-TSK-0707, PV-D): on an interactive install without a denylist, kj ASKS — personal emails, phone/ID, name, public identities — and writes `~/.karajan/privacy.yml` itself (the user never fills YAML by hand; Enter skips any question; answers are never echoed back). Headless installs get a hint, never a block. Protection exists from minute one, not from the day you discover the command.
- **The publish boundary: verify-pack scans the tarball** (KJC-TSK-0706, PV-C): the pre-publish gate now unpacks-and-scans the exact package that would ship — a denylist or secret-shape hit ABORTS the publish (masked), generic PII only counts. And the playbook orders the last boundary: publishing any artifact (a build's `dist/`, a docs site, a tarball) starts with `kj privacy scan <dir>` — nothing personal or secret-shaped ships.
- **Hardcoded secrets join the outbound boundary** (KJC-TSK-0708, PV-E): known token shapes — GitHub `ghp_`, OpenAI `sk-`, AWS `AKIA`, Slack `xox`, Google `AIza`, private-key blocks, JWTs — **block** wherever the privacy engine runs (`kj privacy scan` and the pre-commit gate): a platform token is never legit in an outbound artifact. Credential assignments (`password: "literal"`, `apiKey = '…'`) and connection strings with embedded credentials (`postgres://user:pass@…`) **warn** with the point: *move it to .env or a secret manager*. The personal denylist can only cover what you remembered to list — these detectors cover what it cannot know. Findings masked, allowlist silences known-safe strings.
- **The privacy gate rides the pre-commit** (KJC-TSK-0705, PV-B): `kj review --staged/--check` now scan the ADDED lines of the staged diff — a denylist datum rejects the commit deterministically (masked, with `KJ_ALLOW_PII=1` as the named escape), generic PII warns (`privacy.generic: "block"` hardens). A commit carrying your personal data no longer reaches the repo; existing projects gain the gate on update, no hook regeneration. In the standalone binary (privacy stubbed) the gate degrades with a note instead of crashing.
- **`kj privacy scan` — the outbound privacy boundary** (KJC-TSK-0704, epic KJC-PCS-0070): audit any outbound surface for personal data before it ships — files/dirs (a build's `dist/`, a docs tree) or the staged diff's ADDED lines (`--staged`). Two layers: your personal denylist from `~/.karajan/privacy.yml` (`personal:`/`allow:` — global, never inside a repo: the list itself is sensitive) **blocks** with exit 1, and generic PII (email, phone, DNI/NIE, IBAN, card — karajan-rag's audited `redactPII`, the family engine, detecting and masking in one pass) **warns**. Findings never echo the datum they flag. Born from a real incident: personal emails published on a landing inside release notes. Gate integration (pre-commit, tarball) lands next (PV-B/PV-C).

### Fixed

- **Installing IS activating** (KJC-BUG-0133, field case 2026-08-02): a session "installed karajan" and then wrote an entire feature by hand — no `kj run`, no review, rules violated — because the setup flow ordered `kj harden` + the verdict gate as TEXT steps the agent runs (or narrates), and `kj env install` didn't perform them. A decorative method is worse than none. Now `kj env install` does the enforcement itself, idempotently: git hooks, `core.hooksPath`, and the cross-AI verdict gate — *a commit outside the method is rejected, not narrated*. No git repo → the install BLOCKS pending (the guarantees do not exist without git); enforcement failure blocks too; `--no-enforce` is the named escape. And because a mid-session install lands the playbook in a context the session loaded long ago, the install now ends by PRINTING the method into the conversation: in effect from that very message.
- **The verdict gate no longer deadlocks pure merge commits** (KJC-BUG-0132, issue #1344, found dogfooding PR #1343): a merge that stages no content of its own — e.g. merging main to move the merge-base — had no diff to bind a verdict to, and `kj review --staged` rightly refuses an empty diff, so the commit could never pass the pre-commit gate. `kj review --check` now recognizes the case (MERGE_HEAD present + empty staged diff) and passes with a trail line; a merge WITH conflict resolutions stages real content and still requires its cross-AI verdict.

## [4.9.0] - 2026-07-31

Minor. **Excellent code is a choice, not inertia** — the method now asks the question legacy codebases suppress ("what would you build if this code didn't exist?") and gives the architect a citable canon to answer it with.

### Added

- **The alternatives clause** (KJC-TSK-0696, from proposal KJC-PRP-0011): on legacy codebases agents optimize for local coherence — improving while following the existing line — even when the canonical solution is better. Nothing in the loop asked for the alternative; now the method does. The playbook orders that a non-trivial plan names at least two approaches — **one as if the codebase didn't exist** — and says why the winner won: following the legacy line is a choice, never a default. `kj brief planner` and `kj brief architect` carry the clause where approaches are chosen.
- **The library: distilled engineering canon as a RAG collection** (KJC-TSK-0697, from proposal KJC-PRP-0012): `kj rag query --library "<problem signature>"` serves pattern cards — problem signature, when it beats the default, **when NOT to apply it**, trade-offs and the canonical citation — so the architect can ground the greenfield alternative in citable canon instead of vibes. Cards live in three places: the canon shipped with kj (`library/`), yours (`~/.karajan/library/`) and the project's (`.karajan/library/`); `kj rag index` refreshes them into the global store under their own collection (`project=library`, `kind=library` — invisible to normal project queries). First shipped card: Lamport's logical clocks; the rest of the canon lands next. Underneath, karajan-core 1.4.0 adds the `library` kind with a one-time chunks-table rebuild for older stores (SQLite cannot alter a CHECK) and fixes a real FTS5 subtlety: on external-content tables `COUNT(*)` cannot detect a stale index, so the migration rebuilds it explicitly.

## [4.8.0] - 2026-07-30

Minor. **The security pass an agent self-invokes** — design → scan → remediate in the same session, zero tokens. Closes the trio of controls born from field convergence with how a payments processor operates AI agents.

### Added

- **`kj audit --security` — the security pass an agent self-invokes** (KJC-TSK-0695): a focused deterministic audit (zero tokens) that runs the prompt-injection scan + OSV + Semgrep + Sonar and skips everything else (basal-cost, webperf, madge, knip, ai-slop, harness, LLM). The injection scan now covers the **agent-context surface** — `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`, `templates/`, `.rulesync/` — on top of `.karajan/**`: whatever lands in the host agent's context every session is the real injection vector. The playbook and `kj brief security` now order the agent to run it and remediate BEFORE requesting review whenever a task touches auth, user input, secrets, network or deps. Closes the Akua trio (self-invocable continuous pentest). Fix ride-along: a bare boolean `--security` no longer collides with the global `--security <provider>` role override (provider overrides must be strings).

Minor. **Least privilege for agents** — a subprocess gets what its function requires and nothing more, and every new tool is a conscious access. Two controls born from convergence with how a payments processor operates AI agents safely.

### Added

- **Env allowlist for agent subprocesses** (KJC-TSK-0693): spawned agents (coder/reviewer/tester CLIs) no longer inherit the user's whole environment — only system essentials, the CLI's own auth/config families, and `KJ_*` lane vars. Cloud keys, registry tokens and DB URLs never reach the child, so a compromised agent or injected prompt cannot exfiltrate what it never received. Per-agent extras (`GITHUB_*`/`GH_*` only for copilot); escapes: `security.env_passthrough` (names or trailing-* globs) and `security.env_allowlist: false`. Inspired by Akua's "temporary credentials, never a shared master key" control.
- **AI-surface inventory in `kj check`** (KJC-TSK-0694): the project's reachable MCPs (project `.mcp.json`, `~/.claude.json` scoped to this project, codex and gemini configs) are inventoried on every check; the first run records a baseline silently, later runs flag what APPEARED — `NEW since last check: x — approved by you?` — and what is gone. A nudge, never a gate: every new tool an agent gains is one more access, and an inventory nobody reconciles is the feeling of control without the control.

## [4.6.3] - 2026-07-25

Patch. **Subprocess by right, host by choice** — running kj inside Claude Code no longer hijacks the coder role.

### Fixed

- **CLI providers always spawn as a subprocess** (KJC-BUG-0129, issues #1301/#1303 by @jorgecasar): `isHostAgent()` conflated "running inside agent X" with "the user chose X as provider" — inside Claude Code with `coder: claude`, the pipeline silently delegated to the host via `elicitInput` and hung headless runs. Now every CLI provider spawns its own subprocess even when kj runs inside it; host delegation remains available as an explicit opt-in with `roles.coder.host_delegation: true`.
- **brace-expansion HIGH advisory resolved** (KJC-BUG-0130, nightly drift #994): GHSA-mh99-v99m-4gvg (DoS via unbounded expansion), transitive through `@modelcontextprotocol/sdk` — lockfile-only `npm audit fix`, non-breaking.
- **`kj harden` CI workflows respect the repo's package manager** (KJC-BUG-0131, issue #1330): the generated quality/pack-smoke/mutation workflows hardcoded `npm ci`, killing every PR check in pnpm/yarn repos with `EUSAGE: can only install with an existing package-lock.json`. The lockfile now decides — pnpm gets `corepack enable` + `pnpm install --frozen-lockfile` with `--if-present` BEFORE the script name (pnpm forwards trailing flags to the script), yarn gets `yarn install --frozen-lockfile`. Managed workflows refresh on the next `kj harden` run.

## [4.6.2] - 2026-07-25

Patch. **Warnings stop being negotiable** — a field session rationalized a 522-line PR past the warning, left commits without card refs while asking whether to adopt the convention, and decided a schema unilaterally. Three answers:

### Added

- **`method_gates.pr_size: block`** (KJC-TSK-0691): the review rejects deterministically above the budget without invoking the reviewer; `KJ_ALLOW_LARGE_PR=1` is the explicit, visible escape. The default stays `warn` — now worded without ambiguity: *an oversized warning is not an opinion: partition, or ask your user*.
- **Out-of-AC decisions go back to the user** (KJC-TSK-0691): the playbook orders that any design decision the card's acceptance criteria don't cover be recorded as a proposed ADR (`kj adr add`) and ASKED — never buried in a PR bullet.
- **`prepare-commit-msg` card stamp** (KJC-TSK-0692): `kj harden` installs a hook that stamps the branch's card ref into the commit subject automatically — POSIX-safe, boundary-matched, respecting the 100-char cap, skipping merges. A convention that enforces itself needs no adoption; the method report's "commits with card ref" squares itself.

## [4.6.1] - 2026-07-25

Patch. **No session works blind** — the update notice now tells you what the new version brings, and the agent asks before updating.

### Added

- **Update notice with release highlights** (KJC-TSK-0690): the per-invocation cached version check now fetches the new version's CHANGELOG headline once and prints it — `What it brings: Minor. The method, enforced. …` — alongside the channel-aware update instruction. Check TTL lowered to 6h (several releases can ship in a day); `KJ_NO_UPDATE_CHECK=1` skips it (CI). The notice and the playbook both order the agent: tell your user what it brings and ASK — never run `kj update` on your own. Updating is always a human, informed decision.

## [4.6.0] - 2026-07-24

Minor. **The method, enforced.** v3 commanded but couldn't think; v4 thinks but narrates — so every method rule climbs from playbook text to its deterministic ceiling: gate, nudge, or trail (épica KJC-PCS-0068).

### Added

- **Card-first gate** (KJC-TSK-0686): with hu-board, the branch must reference a LIVE card or the commit does not enter (token-boundary matching, live-preferring scan); planning-game/external boards get a presence check (warn default, `method_gates.card_first: block` to harden). Base and release branches are exempt; `KJ_ALLOW_NO_CARD=1` is the explicit escape. Rides inside `kj review --check` — existing hooks gain it on update, no regeneration.
- **Tests-with-code gate** (KJC-TSK-0687): a staged diff touching sources without a single test change warns with the list (block via `method_gates.tests_with_code`); uses the project's own `development.*` patterns; docs/config-only diffs pass silently; `KJ_ALLOW_NO_TESTS=1` escape.
- **Runtime nudges** (KJC-TSK-0688): moving a SECOND HU to running suggests the exact `kj worktree start` command (only on the real transition); staged diffs above `method_gates.pr_size_warn` (150 added lines) get an informative note — never a block.
- **Method adherence report** (KJC-TSK-0689): `kj check` and `kj doctor` show the aggregate trail — commits with card refs, verdict workspaces (root vs lanes), source commits without tests. Individual deviations can be legitimate; the aggregate is the drift detector.

## [4.5.0] - 2026-07-24

Minor. **Any board — but always a board.** Projects that already live in Linear, Trello, Jira or GitHub Issues get card-first pointed at THEIR board; and no project runs without one (closes #1287).

### Added

- **External boards as source of truth** (KJC-TSK-0684): `state_backend: external` + `board.name` make the playbook's card-first invariant point at the project's own board, worked through the host agent's MCP/tools. kj never mirrors it: `kj hu add|move` refuse with the pointer, `kj board` doesn't start a parallel dashboard (`stop` stays available for cleanup). Default `hu-board` unchanged.
- **`kj env install` guarantees an operational board** (KJC-TSK-0685): hu-board is ok by construction (it ships with kj); planning-game requires its MCP in a host agent config; external requires the named board's MCP or an API token (per-board convention or `board.token_env`). No access path → PENDING-USER-ACTION block (exit 3) with the exact steps, before the RAG step. **There is no `none`: Karajan does not run without a board** — the board is what guarantees ordered, card-first work and meaningful lanes.

## [4.4.1] - 2026-07-24

Patch. **The ONNX fallback actually works now** — and the repo's three-AI arbitration had its first real run.

### Fixed

- **v4.4.0's ONNX fallback never worked on a clean machine** (KJC-BUG-0128): the `kj env install` index probe opened the vector store just to check — and opening runs the DDL, creating the vec table at Ollama's 768 dims. The ONNX fallback then failed every 384-dim insert with a dimension mismatch. The probe no longer creates anything (file check first), an EMPTY wrong-dim store is reset (read-only plain-sqlite inspection; a store with data is never touched), and the return-to-Ollama hint now describes the real procedure instead of a nonexistent `--rebuild` flag.

Process milestone: the cross-AI reviewer rejected this fix on a factually wrong premise — `kj solomon` (Copilot as arbiter) ruled for the brain on empirical evidence, the first real arbitration in this repo's own gate.

## [4.4.0] - 2026-07-23

Minor. **karajan-rag protects karajan-code** — the first dependency between the two products, and a RAG that works on machines where nothing can be installed.

### Added

- **Sensitivity gate + PII redaction for cloud embedders** (KJC-TSK-0682, card filed by the karajan-rag session after its independent security audit): cloud embedders (openai/voyage/cohere/mistral) now require an explicit `rag.sensitivity: public` — the safe default (`internal`) blocks with an actionable error, never a silent downgrade. Even when allowed, every chunk passes through karajan-rag's audited `redactPII` (emails, phones, NIF/NIE, IBAN, cards) before leaving the machine. Local providers (ollama/onnx) pass through untouched. New dependency: `karajan-rag ^1.2.0`.
- **ONNX fallback when Ollama is unavailable** (KJC-TSK-0683): on limited machines, the first index with the default provider falls back to the built-in in-process ONNX embedder (no installs, CPU) and persists the choice in the project config via surgical YAML edit — comments and user keys survive. An explicit provider choice is always respected.

## [4.3.1] - 2026-07-23

Patch. **Complete stories, isolated lanes** — both halves requested from the field (issues #1296 and #1306).

### Added

- **`kj hu add` takes the full spec in one call** (KJC-TSK-0678, issue #1296): `--ac` and `--tests` (repeatable, multiline strings split per line), `--scope`, and a validated `--task-type`. An incomplete spec warns immediately with the exact missing flag — the same material `kj run`'s spec review would demand later.
- **Environment isolation for parallel lanes** (KJC-TSK-0681, issue #1306): `session.worktree_setup` documented inline with a lane-aware example; the generated `coder-rules.md` teaches env-var discipline deriving per-task values from the `KJ_LANE_SLOT` / `KJ_PORT_OFFSET` the slot registry already injects; `review-rules.md` rejects hardcoded ports/DB names and committed `.env` files.

## [4.3.0] - 2026-07-23

Minor. **Isolation you can prove.** A field case: the playbook said "one worktree per task" and an agent narrated the isolation while editing the project root. Ordering a practice invites narration; ordering a command gets execution — and now the claim leaves a trail.

### Added

- **`kj worktree start|list|done`** (KJC-TSK-0679): isolated task lanes for the host agent. `start <slug>` creates the worktree in `.kj/worktrees/<slug>` (the same lane dir the headless pipeline uses) with its `feat/<slug>` branch, bootstraps dependencies, and prints the exact `cd`; `done <slug>` removes a merged lane (refusing uncommitted changes without `--force`). The playbook now orders the COMMAND and demands the isolation proof: in a lane, `git rev-parse --git-dir` differs from `--git-common-dir`.
- **The review verdict stamps its workspace** (KJC-TSK-0680): every `kj review --staged` records where it ran — `✓ APPROVED by codex (diff …) [root]` or `[worktree:<name>]`. Working from the root stays legitimate for single-task work, but if the agent claims isolation and the verdict says `[root]`, the trail talks.

## [4.2.1] - 2026-07-23

Patch — including the first external contribution of the v4 era.

### Fixed

- **The board's per-HU play button passes the HU's own title to `kj run`** instead of the generic `plan.task` (issue #1297) — no more false spec-review failures on well-defined HUs. Fix contributed by **@jorgecasar** (#1298).

### Added

- **The playbook now orders git worktrees for parallel work** (KJC-TSK-0677): working on more than one task, or the base tree must stay untouched → one `git worktree` per task; the gates travel with the repo and work there. In v4 the host agent does the work — the playbook is where it inherits the lane-isolation practice the headless pipeline already uses.

## [4.2.0] - 2026-07-23

Minor. **Sonar is a gate now, not discipline.** With the brain outside the core (v4), skipping static analysis was one decision away — proven the day the brain itself shipped three sonar issues in new code and nothing stopped it. Now the review gate does.

### Added

- **Sonar pre-gate in `kj review --staged`** (KJC-TSK-0676): before any AI opinion, sonar scans (single-flight via the tool governor) and the findings on the CHANGED files print first. **BLOCKER/CRITICAL findings reject deterministically — exit 1, cross-AI reviewer not invoked, zero tokens spent.** Advisory findings travel inside the reviewer's task so the verdict weighs them. Sonar down or no Docker → a loud `⚠ sonar pre-gate skipped: <reason>` and the review continues; `--no-sonar` (or `review_gate.sonar: false`) opts out explicitly.

### Fixed

- Three pre-existing sonar MAJORs in `review-gate.js` — surfaced by the pre-gate reviewing its own diff on its first live run.

## [4.1.11] - 2026-07-23

Patch. **Agents can run kj unattended, and the board refuses twins** — both requested from the field (issues #1288 and #1289).

### Added

- **Non-interactive mode for `kj run` / `kj resume`** (KJC-TSK-0674, issue #1289): `--non-interactive` flag or `KJ_NON_INTERACTIVE=1` env force auto-answering even under a pseudo-TTY, instead of blocking forever on a board modal nobody watches. The spec-review gate is now severity-aware: warn findings auto-continue (decision streamed to stderr); FAIL findings stop the run with **exit code 1** — and interactively, Enter at FAIL now defaults to cancel. An aborted run/resume is finally observable by CI.
- **Cross-plan title dedup on `kj hu add`** (KJC-TSK-0675, issue #1288): an identical normalized title on any live HU of any plan is refused with the existing card's ref; heavily-overlapping titles warn with the candidates. `kj brief board` and the playbook now order the precondition: `kj hu list` BEFORE `kj hu add` — reuse the covering card.

## [4.1.10] - 2026-07-22

Patch. **Karajan governs its tools' resources, not just your code** — born from a real CPU storm (concurrent scans, semgrep taking 14 cores each, orphaned semgrep-core processes).

### Added

- **Tool governor** (KJC-TSK-0668): every external scanner kj launches now runs governed — machine-wide single-flight (a second kj needing the same tool waits instead of scanning in parallel; locks from dead processes are stolen), `--jobs` capped at half the CPUs for semgrep, reduced priority (nice +10), and hard timeouts that kill the whole process tree, so an interrupted scan can never leave orphans burning CPU.
- **`kj doctor` orphan check**: detects scanner processes reparented to init or a systemd reaper, reports them with the exact cleanup command, and offers to kill them.

## [4.1.9] - 2026-07-22

Patch. **Warnings you can act on** — the fourth field issue filed by a user's Karajan, fixed and auto-closed within hours.

### Fixed

- **Dashboard prompt modals show the FULL spec-review findings** (KJC-BUG-0125, issue #1275 — fourth self-healing cycle): each finding renders as a readable severity-colored entry with its message and the concrete suggestion, instead of "4 findings at severity fail" and a collapsed JSON blob. The full findings travel with the prompt in both the interactive and the autonomous paths (capped at 20, real total always visible).
- **`kj-run-smoke` no longer flakes on Node 24 CI** (KJC-BUG-0126): the positional `mockResolvedValueOnce` chains — misaligned by any order shift in the orchestrator's probes — are replaced by command-keyed mocks that describe the world, not a fragile sequence.

## [4.1.8] - 2026-07-22

Patch. **The board becomes ungameable** — the dashboard-vs-agent fights reported from the field (an agent "fixing" warnings by deleting and recreating tasks) end here, the Planning Game way: the code forbids it AND the agent is taught why.

### Added

- **`kj brief board`** (KJC-TSK-0670): the board's model for any brain — cards are permanent; states move only via `kj hu move`; a duplicate short_id means update, never a twin; a warning is fixed with the command it names or reported with `kj report-issue`, never by destroying state. The playbook's tracking invariant now states card permanence.

### Fixed

- **HUs are never deleted** (KJC-TSK-0669, absolute product rule): the plan-review fix loop ARCHIVES instead of removing (status `skipped` + `archived_by` + reason, references cleaned so nothing deadlocks); `kj hu add` with an existing short_id refuses with the norm spelled out; `DELETE /api/stories/:id` on the board answers 405 (KJC-TSK-0671).
- **The board stops silently hiding version-drifted plans** (KJC-BUG-0124, issue #1277 — third field issue filed by a user's Karajan via `kj report-issue`, third full self-healing cycle): `syncPlanFile` accepts any v2+ plan with a loud warning on drift; the strict `version !== 2` check made whole plans vanish from the dashboard with no trace — the root cause behind "my tasks disappeared".

## [4.1.7] - 2026-07-22

Patch. **A field day, literally**: the second self-healed issue closed its full cycle, Windows reached full-product parity, and every HU now says where it came from.

### Added

- **Windows installer goes npm-first** (KJC-TSK-0667): `irm karajancode.com/install.ps1 | iex` now installs the FULL product — the machine's Node ≥ 22.12 or a checksum-verified official LTS auto-provisioned into `~\.karajan\node` (staging + backup + restore swap, self-contained `--prefix`, both shims validated before the swap). The SEA binary moves behind `$env:KJ_STANDALONE = "1"`. Same guarantees as the sh installer, Windows PowerShell 5.1 compatible.
- **HU provenance** (KJC-TSK-0661, Jorge's friction): every HU records who created it — the detected host agent, `human`, `agent`, `planner` or `plan-reviewer`. `kj hu list` shows `[plan · by whom · date]` per line plus a next-action hint; `--json` exposes `created_by`/`created_at`. No more untraceable cards on the board.

### Fixed

- **`kj init` writes the karajan contract block to .gitignore** (KJC-BUG-0123, issue #1268 filed by a user's Karajan via `kj report-issue` — second full self-healing cycle): review verdicts stay local while the gate/hooks/ADRs stay trackable. The orchestrator's autoInit stops writing the bare `.karajan/` exclude that silently broke gate inheritance; both paths now share one exported `CONTRACT_BLOCK`.
- **External scanners never fire from the unit suite** (KJC-BUG-0122): on machines with the full stack installed, parallel vitest workers each launched a real `semgrep --config auto` whole-repo scan (load average 50, orphaned processes). Kill-switch in the semgrep/osv collectors under `VITEST`; e2e opts in with `KJ_ALLOW_REAL_SCANS=1`. Verified with a PATH spy: 24 invocations before, 0 after.

## [4.1.6] - 2026-07-22

Patch. **GitHub Copilot CLI joins the orchestra.** The free-tier era of AI CLIs keeps shrinking (gemini retired, Qwen OAuth discontinued 2026-04-15) — Copilot rides a subscription many developers already have.

### Added

- **GitHub Copilot CLI as seventh built-in agent** (KJC-TSK-0666): `@github/copilot` (binary `copilot`) — non-interactive `-p` mode with `--output-format json` (JSONL); kj extracts the final `assistant.message` content. Review/arbitration runs WITHOUT tool grants plus an explicit no-tools instruction (headless can never approve a tool request); coder mode grants tools. Model pinnable per role (`roles.solomon.model`) — Copilot's automatic routing varies per run. Contract verified live against copilot 1.0.73, including a real end-to-end arbitration answer. Known limit: no stdin prompt channel, so very large diffs share claude-agent's E2BIG bound (KJC-BUG-0121).

## [4.1.5] - 2026-07-21

Patch. **Arbitration works again — with a new judge.** The gemini individual tier retirement (IneligibleTierError → Antigravity) left machines without an operational third AI, and the first real arbitration attempt surfaced a cascade of spawn bugs.

### Added

- **Qwen Code as sixth built-in agent** (KJC-TSK-0665): `@qwen-code/qwen-code` (binary `qwen`) — a gemini-cli fork with the same headless interface, cloud-backed and free with a Qwen account. Registered, detected, and eligible as solomon arbiter. Set `roles.solomon.provider: qwen` to keep solomon off a zombie gemini binary.
- **Versioned bootstrap prompts + `start.md` router** (KJC-TSK-0663): `docs/prompts/{start,install-machine,project-new,project-legacy}.md`, served at `karajancode.com/start.md` (302 to raw main). One line to your agent — "read karajancode.com/start.md and do what it says" — covers machine install, new project and existing codebase, always under stop-and-wait.

### Fixed

- **`kj solomon` is operational** (KJC-BUG-0121, three layers): the arbiter prompt (whole diff embedded) travels via **stdin**, never as a CLI argument (E2BIG on large diffs); every gemini spawn declares `GEMINI_CLI_TRUST_WORKSPACE`; and when the arbiter fails at runtime (dead tier, auth), the error names the alternative agents for `roles.solomon.provider` instead of just the wreckage.

### Changed

- **README is v4-first** (KJC-TSK-0664): the npm/GitHub front page now tells the v4 story only — the full v3 README (EN+ES) is preserved verbatim under `docs/README.v3*.md` as a linked historical archive.

## [4.1.4] - 2026-07-21

Patch. **The self-healing loop closed its first full cycle**: a user's Karajan filed issue #1256 via `kj report-issue`, and this release ships the fix.

### Fixed

- **Distro-aware semgrep guidance — PEP 668 safe** (KJC-BUG-0120, issue #1256): on Debian 12+/13 the system Python is externally managed and often ships without pip, so the suggested `python3 -m pip install --user pipx` bootstrap failed twice over. All three surfaces now recommend the distro route (`sudo apt update && sudo apt install -y pipx && pipx install semgrep`, dnf equivalent): `semgrepFallback` (docker → apt → dnf → generic last resort), doctor's hint via display-only `DISTRO_FALLBACKS` (sudo never auto-runs — it flows through stop-on-sudo), and the `PENDING USER ACTION` block, which additionally stops re-suggesting a command that just failed and prefers the curated per-OS route instead.

### Changed

- **Nightly drift cleared** (KJC-TSK-0660, issue #994): `npm audit` down to 0 vulnerabilities (hono, brace-expansion, js-yaml and four more highs) via audit fix + in-range updates (vitest 4.1.10, eslint 10.7, prettier 3.9.6, better-sqlite3 12.11.1, helmet, express-rate-limit, knip and friends). Major jumps deliberately excluded — better-sqlite3 13 waits for the node:sqlite epic.

## [4.1.3] - 2026-07-21

Patch. **Perfectly installed, or stopped with instructions — never degraded.** Field policy from the third fresh-machine install: a session that times out into "continuing with my own judgment" past a missing Docker leaves a useless environment (RAG indexed 0/727 chunks and nobody noticed).

### Added

- **Stop-on-sudo policy in `kj install-tools`** (KJC-TSK-0659): anything kj cannot install unattended — sudo required, no route on this OS, a failed attempt, or a non-TTY auto-decline nobody actually made — becomes ONE `PENDING USER ACTION` block with the exact commands for this machine's OS (Linux apt/dnf, macOS brew, Windows winget/WSL) and a distinctive **exit code 3**, so a driving agent stops, shows the block, and waits for the user. A real interactive decline is still respected; `--dry-run` keeps exit 0.
- **`kj env install` blocks when the RAG cannot index** (KJC-TSK-0659): a first index that embeds 0 of N files, or an embedder crash, is no longer reported as success — the command emits the pending block (per-OS Ollama instructions, or a config pointer for cloud embedders) and exits 3. The playbook stays installed; the false green does not. The landing's AI-CLI prompt now carries the matching HARD RULE: stop on sudo/exit-3, show the commands, WAIT.
- The v4 playbook names `kj hu add|move|list` and `kj adr add|list` in its tracking invariant and commands line (AB-H follow-up).

### Fixed

- **`kj harden` no longer eclipses existing configs** (KJC-BUG-0119): seed-if-absent recognizes every same-tool variant (`eslint.config.mjs`, `.eslintrc.*`, `.commitlintrc.yml`, `prettier.config.mjs`, inline package.json config…) as "the config exists" and reports `covered` instead of creating kj's default filename next to it — which ESLint would resolve FIRST, silently disabling the project's real linting. Field-hit on a Next.js repo with `eslint.config.mjs`.

## [4.1.2] - 2026-07-21

Patch. **One pass, fully operational.** Direct feedback from a fresh-laptop install: the installer left a minimal setup. No more.

### Added

- **`kj install-tools` covers the full stack** (KJC-TSK-0657): rtk, squeezr and qmd (token/context optimizers, previously init-only) join git, agent CLIs, Semgrep, OSV-Scanner, Lighthouse, Docker and SonarQube in the default tool list — reusing the init installers, asking before each install, planning under `--dry-run`, and reporting failures with their error. A fresh machine ends 100% operational in one pass. The landing's install prompt now recommends npm explicitly (native-module features) and drives `kj install-tools` as part of the setup.

## [4.1.1] - 2026-07-21

Patch. **Three field frictions closed so a fresh install just works** — all three reported by the environment's first external users.

### Fixed

- **Doctor reads a missing MCP as a degraded optional, not a broken install** (KJC-BUG-0118): the standalone (curl) binary ships without native modules by design, so `karajan-mcp` cannot run from it. Doctor now says the MCP is OPTIONAL in v4 (your agent drives kj via CLI; only shell-less hosts need it), names which features actually require the npm install (RAG, board, MCP), and stops implying the install is broken.
- **`kj review --install-gate` makes the contract trackable by itself** (KJC-TSK-0646): a `.karajan/` dir-exclude in .gitignore silently kept the gate marker and hooks out of git (git cannot re-include children of an excluded directory) — the team never inherited the gate. install-gate now rewrites the pattern in place: every root exclude removed (a later duplicate would override the re-includes), partial hand-written contracts completed and deduped, everything else byte-identical.
- **Pre-push drops the test suite when CI already runs it** (KJC-TSK-0647): full-suite-per-push was redundant with CI and a false-red source under local parallelism. The generated pre-push keeps the identity guard and global-hook chaining; `kj.harden.test_on_push: true` in package.json opts back in; repos without CI keep tests on push — there it is the last safety net.

## [4.1.0] - 2026-07-21

Minor. **Any-agent brain: any AI CLI is the orchestrator, and the system repairs itself.** One day after v4.0.0, the environment generalizes: the brain can be Claude Code, Codex, Gemini CLI or Cursor; role knowledge moves into commands the brain reads; conflicts between AIs get a neutral third arbiter; and field frictions flow upstream as sanitized issues instead of chat screenshots.

### Added

- **`kj solomon --position "<why>"`** — when the brain disagrees with a rejected review verdict, a THIRD AI arbitrates (never the brain, never the reviewer; two-agent machines get an actionable error, never self-arbitration). An approve ruling records a `solomon:<agent>` verdict for the exact diff — the gate opens structurally; a reject keeps it closed. The full conflict (original verdict, brain's position, ruling, reasoning) is recorded for audit. **Security findings are never arbitrable**: the reviewer's JSON schema now carries a structured `category`, and security issues block arbitration without even consulting the arbiter.
- **`kj brief <role>`** — the distilled method of triage, planner, researcher, architect, tester, security and audit, for the brain to execute or delegate. Written outcome-first: Mission + Invariants + Deliverable, never step scripts (frontier models pick better paths alone; what they need explicit are the limits). The playbook itself was rewritten the same way — and got shorter.
- **`kj agent run <agent> "<task>"`** — the brain's inter-agent bus: delegate work to another AI with kj handling binary detection, subprocess workarounds and usage capture. `--json` is a strict machine contract (exactly one JSON object on stdout, even when the delegate crashes).
- **`kj report-issue`** — the self-healing loop: any user's brain diagnoses a kj friction and files it upstream. Sanitized by construction (home paths collapse to `~`, emails redacted, never project code), deduped against open issues (recommending a comment over a duplicate), and it never publishes without `--publish` — a human decision, as the playbook orders.
- **`kj env install --target gemini | all`** — the playbook now also lands in GEMINI.md; `all` (the new default) covers CLAUDE.md + AGENTS.md + GEMINI.md from the single source. AGENTS.md already covers Cursor and the emerging standard.
- **`kj init --json`** and a no-TTY notice — init explains why it fell back to defaults, and `--json` turns stdout into a machine contract for host agents. Audited the remaining wizards: none can hang without a TTY.

### Docs

- **New v4 documentation** (karajancode.com): five outcome-first pages — Install, Work with your agent, The gates, Command reference, Headless mode — in English and Spanish. Everything prior is grouped under "v3 (legacy)": the framing is legacy, the code is current.

## [4.0.1] - 2026-07-21

Patch. **First-day field feedback from the v4 environment, folded back in.** Both fixes come from real installs of the environment on day one — one by the maintainer, one by an external host-agent session.

### Fixed

- **Generated hooks chain to the machine's previous global hooks** (KJC-TSK-0645): `kj harden` sets a repo-local `core.hooksPath`, which ECLIPSED the user's global hooks dir — personal guards (AI-attribution commit-msg, protected-branch pre-push) silently stopped applying in hardened repos. `installHooks` now detects the previous global `core.hooksPath` and every generated hook ends by chaining its global namesake: `-x` guarded (machines without it are unaffected), arguments propagated, and the chained hook's REAL exit code re-emitted. Tildes are written as `$HOME` so committed hooks stay portable.
- **Branch-first, ordered and enforced** (KJC-TSK-0648): the playbook only implied "atomic PRs" — an external session following it to the letter committed the v4 contract on local main. The playbook now has an explicit step ("never commit on the base branch — every change reaches it through a PR") and harden's pre-commit gains a base-branch guard: direct commits on the configured `base_branch` are rejected with an actionable message (`KJ_ALLOW_BASE_COMMIT=1` to override for releases); feature branches and detached HEAD are unaffected.

## [4.0.0] - 2026-07-20

Major. **Karajan v4 is an ENVIRONMENT: the host agent orchestrates, Karajan governs.** Born from a real-world demo where the subprocess loop produced an integral false green (5 "approved" iterations with zero reviewer passes — fixed in 3.15.3) while three days of the inverse model (a human tasking a host agent under deterministic gates) never let a single error through. v4 makes that inverse model the product: you work with Claude Code or Codex as the orchestrator, and Karajan installs the method, the tools and the git gates that make a false green structurally impossible. Everything ships additively — the subprocess runtime continues as the headless mode with the same gates, and no existing config breaks.

### Added

- **`kj env install`** — installs the Karajan playbook as a managed block in the host agents' rule files (CLAUDE.md for Claude Code, AGENTS.md for Codex) from ONE source: RAG before coding, card first, TDD, cross-AI review before committing, security checklist, atomic PRs. Under 60 lines by test; user content outside the block is never touched; re-running is idempotent. It is also RAG-first: when the project has no index, it builds one (`--no-rag` opts out).
- **`kj review --staged`** — reviews the staged diff with an AI **different from the host** (host detected via environment; a configured reviewer that matches the host is overridden; no cross reviewer available is an error, never a silent same-AI fallback) and records the verdict in `.karajan/reviews/<sha256-of-the-raw-diff>.json`. The hash ties the verdict to byte-exact content: change the code and the verdict is void — resolve-until-pass by construction. `--check` verifies the staged diff has an approved verdict (exit 0/1, hook-friendly), `--range` reviews a git range, `--install-gate` enables the gate.
- **Pre-commit review gate** (opt-in via `kj review --install-gate`, marker tracked in git so the whole team inherits it): without an approved cross-AI verdict matching the staged diff, **the commit does not enter**. Fails closed when kj is missing.
- **`state_backend`** (`hu-board` | `planning-game`, default `hu-board`) — where work items live; the playbook's "card first" step names the chosen backend.
- **`kj rag query` drift update** — before searching, the index delta-updates from the last indexed commit, so retrieval never serves stale code (`--no-rag-update` opts out). Full indexing now stamps the HEAD commit — previously the FIRST full index never armed the drift check.
- **Headless verdict stamping** — `kj run` sessions record their internal reviewer's verdict for the staged diff before committing, so pipeline commits pass the v4 gate in gated repos.

### Changed

- **karajan-code itself now runs under the v4 environment**: every commit to this repo requires an approved cross-AI verdict. The activation commit was the first one governed — codex rejected the initial version with two legitimate issues before approving.
- RTK is never used for internal git/diff plumbing (see 3.15.3); detection remains so agents can use it in their own shell.

## [3.15.3] - 2026-07-19

Patch. **The integral false green found by the complex real demo is fixed — the last 3.x release before v4.** A 5-iteration run that ended "approved" with zero reviewer passes, zero post-loop stages and zero push can no longer happen: every layer of that chain is closed.

### Fixed

- **RTK no longer wraps the pipeline's internal git/diff commands** (KJC-BUG-0115, layer 1): with RTK installed, `rtk git diff` returns a compressed summary without `diff --git` headers, so the TDD gate parsed 0 changed files and failed forever with "(2 src, 0 test)" while the coder's real tests sat committed in the branch. Internal plumbing now always runs raw git; RTK keeps saving tokens where it belongs — inside the coder agent's own shell.
- **The TDD gate no longer short-circuits the reviewer** (KJC-BUG-0115, layer 2): at the TDD sub-loop limit under Brain, the iteration used to end before `runReviewerGateStage` — codex never reviewed a single line in 5 rounds. The gate now proceeds to the reviewer with the TDD failure queued as pending feedback.
- **"Finalizing as approved" at max_iterations now runs the real finalize path** (KJC-BUG-0116): Brain/Solomon approval at the iteration cap returned a bare result, skipping tester, security, final audit AND git push/PR. It now routes through the same post-loop + finalize used on reviewer approval; if post-loop rejects the work, the session honestly reports `post_loop_rejected_at_max_iterations` instead of a false green.
- **Journals no longer report "Iterations: 0" after real iterations** (KJC-BUG-0117): iterations that ended before the reviewer were never recorded; they now land in the journal from every exit path.
- **Budget ceiling no longer shows "$X / $0.00"** (KJC-BUG-0114): a config carrying `max_budget_usd: null` produced a phantom $0.00 ceiling (`Number(null) === 0`) and a permanent warn state. null now falls back to the shipped default ($5), explicit 0 means "no ceiling", and `kj report` resolves the effective ceiling for sessions logged before the fix.

## [3.15.2] - 2026-07-19

Patch. **The Quick Start scenario no longer burns budget or dies on a retired Gemini CLI.** Both bugs were caught by following the landing's Quick Start to the letter with a fresh npm install.

### Fixed

- **No-remote repos skip push/PR automation** (KJC-BUG-0112): on a fresh `git init` folder — the canonical Quick Start scenario — the post-approval automation ran `git fetch origin`, threw, and escalated to Solomon on EVERY iteration ($2.57 observed on a ~$0.50 run, with the whole budget at risk). `finalizeGitAutomation` and CommiterRole now detect the missing remote and skip with "No remote configured — skipping push/PR automation".
- **A retired Gemini Code Assist CLI no longer poisons runs** (KJC-BUG-0113, first layers): its `IneligibleTierError` now classifies as `AUTH_FAILED` (non-recoverable, actionable message) instead of `UNKNOWN_FATAL`; agent binary probes carry a 5s timeout so a zombie CLI can't hang init/preflight; and Solomon's hardcoded fallback provider moves from `gemini` (dead for individuals) to `claude`.

## [3.15.1] - 2026-07-19

Patch. **`npm install -g karajan-code` no longer silently installs a months-old version on Node 22.0-22.21.**

### Fixed

- **engines.node lowered to the real runtime floor, `>=22.12.0`** (KJC-BUG-0111, caught by following the Quick Start to the letter with a fresh install): every 3.x release declared `>=22.22.1` — a floor inherited from lint-staged 17, a devDependency end users never run. npm resolves the newest version whose engines match your Node, so any install on Node 22.0-22.21 silently received **karajan-code@2.34.0** with zero warnings. The actual runtime floor is commander 15's `>=22.12.0`; all four workspaces now declare it.

## [3.15.0] - 2026-07-19

Minor. **Parallel lanes ready for real projects, Kimi + DeepSeek as first-class priced models, and a fully decoupled HU Board.**

### Added

- **Lane worktree bootstrap** (KJC-TSK-0630): each fresh parallel-lane worktree is made operative before the coder lands — submodules initialized, then `session.worktree_setup` (or `npm ci` when a lockfile exists). Best-effort: failures warn and the lane continues. Without this, `--parallel` lanes on any real project died on the first `npm test` of a clean checkout.
- **Per-lane slots and port offsets** (KJC-TSK-0631): every parallel lane acquires a stable numeric slot (`karajan-core/slot-registry`, file-locked, released on cleanup) and its coder + acceptance tests receive `KJ_LANE_SLOT` / `KJ_PORT_OFFSET` so services they start don't collide on ports. Design credit: Jorge del Casar's worktree-docker-envs skill. See "Services per lane" in `docs/parallel-hus.md`.
- **Kimi and DeepSeek with real pricing** (KJC-TSK-0633): the `kimi-k2` family (Moonshot) and `deepseek-chat`/`deepseek-reasoner` join the model registry — used through OpenCode as OpenAI-compatible providers, the per-HU $ badge and `max_budget_usd` enforcement now price them correctly instead of flying blind. Full setup snippet in `docs/providers-via-opencode.md`.

### Changed

- **@karajan/hu-board is fully decoupled from the CLI source tree** (KJC-TSK-0632): the rag subtree the board consumes (retriever, embedders, rerank, where-parser) moved to `karajan-core/rag` with re-export shims left behind, and the board resolves everything through the `karajan-core` package — zero relative imports into `src/`, enforced by a new architecture test. Closes the remaining item of the core extraction (KJC-TSK-0511).

### Fixed

- **verify-pack pnpm smoke vs release-age quarantine**: modern pnpm silently resolves freshly published dependencies to OLD versions (`minimumReleaseAge` supply-chain protection), failing the tarball gate right after a `karajan-core` publish. The smoke now passes `--config.minimum-release-age=0` — it verifies packaging, not release-age policy.

### Dependencies

- Requires `karajan-core >= 1.3.0` (published) — ships `./rag/*` and `./slot-registry`.

## [3.14.1] - 2026-07-17

Patch. **`--parallel` now actually parallelizes — inside real worktree lanes.** The 3.14.0 flag silently degraded to sequential, and lanes shared the main working tree. Everything here came out of a real end-to-end run of the feature (live coder, 4-HU plan, `--parallel 2`).

### Fixed

- **`--parallel N` no longer degrades to sequential silently** (KJC-BUG-0110): `planToHuBatch` dropped the plan's `scope` field during conversion, so the scheduler — which conservatively treats scopeless HUs as exclusive — never paired anything. Scope now survives into the batch (and through the plan-edit reconcile). Verified e2e: a 3-HU batch pairs disjoint-scope HUs into a real parallel chunk.
- **Worktree lanes are now truly isolated** (KJC-TSK-0629, PRs #1196-#1198): the coder prompt, pre-coder snapshot, acceptance tests, TDD/review diffs, sonar and the final commit/push all run INSIDE the lane's worktree on branch `kj-hu-<id>` — concurrent lanes never move the main working tree. Per-lane copies of config, pipeline flags, session and Brain state stop policies and reviewer feedback leaking across lanes. Also fixes a latent leak where `max_iterations` stayed clamped to `hu_max_iterations` after any acceptance-tested HU.
- **`kj plan ready` no longer rejects every generated plan** (KJC-BUG-0108): the auto-injected `[PREFLIGHT-000]` HU shipped without a `status` field and plan validation failed with "invalid status undefined".
- **`--yes` answers questions that declare a safe default** (KJC-BUG-0109): unattended runs stopped cold on the spec-review gate even at info severity with "(default: continue)" on screen. Callers can now declare `defaultAnswer`; `--yes` presses Enter for you and logs it. Questions without a declared default still stop loudly.

## [3.14.0] - 2026-07-17

Minor. **Step mode and governed parallelism.** You can now supervise the orchestra iteration by iteration — and parallel HU execution, which previously ran unbounded, is capped, budgeted and opt-in.

### Added

- **Per-iteration gate — `kj run --step`** (KJC-TSK-0628): the pipeline pauses after EVERY iteration with a compact report — iteration n/max, the reviewer's verdict with its must-fix list, what the next iteration will do, spend vs cap — and asks: Enter continues, `stop` stops (resumable with `kj resume`), and **any other text becomes a directive** injected into the feedback the coder reads next iteration, never clobbering the reviewer's own list. Also offered as a question in the `kj init` wizard; unattended autonomous runs pass through.
- **Governed parallel HU execution — `kj run --parallel <n>`** (KJC-TSK-0622..0626): plans can run HUs concurrently, each in its own git worktree under `.karajan/worktrees/`, scheduled over the `blocked_by` graph with conservative scope isolation (overlapping or scopeless HUs never run together), a shared semaphore, and a **plan-level budget ceiling** (`n × max_budget_usd`) that stops the batch loudly when exhausted. The SonarQube stage serializes across lanes.

### Fixed

- **Parallel execution is now bounded — default 1, fully sequential** (KJC-TSK-0626, related to KJC-BUG-0107): the HU sub-pipeline used to launch dependency groups with an UNBOUNDED `Promise.all` — a plan with N independent HUs ran N full coder pipelines at once, with no cap and no shared budget. That path is now opt-in and governed; the safe sequential behaviour is the default.

## [3.13.1] - 2026-07-16

Patch. **Every run now ships with a spend ceiling.** A stuck or runaway pipeline can no longer drain a subscription quota unattended.

### Fixed

- **`max_budget_usd` defaults to 5** (KJC-TSK-0621, from a field report of a stuck run burning a user's whole quota): the per-iteration budget enforcement existed but the default was `null` — opt-in safety. Exceeding the cap stops the run with the spend, the limit, how to raise it and how to continue (`kj resume` opens a fresh window). Explicit `null` opts out; the legacy `session.max_budget_usd` location keeps working.

## [3.13.0] - 2026-07-16

Minor. **`kj harden` respects your own tooling.** A repo that formats and lints with Biome no longer gets kj's eslint + prettier planted next to it.

### Added

- **Cross-tool alternatives in harden/check** (KJC-TSK-0614): a user's `biome.json`/`biome.jsonc` replaces both eslint and prettier, but harden only knew same-tool filename equivalents — it classified them as missing, seeded kj's configs next to Biome and `kj check` flagged their absence as drift. A new alternatives map is consulted by all three surfaces: the advisory reports `SATISFIED_BY_ALTERNATIVE` ("covered by biome.json — kj won't add a second linter/formatter"), config seeding skips the covered artifacts, and `kj check` treats them as ok. Your own config of the same tool still wins; `.editorconfig` and commitlint (not replaced by Biome) keep seeding; pre-commit hooks and the Quality workflow already delegate to the project's `npm run lint`/`format` scripts.

## [3.12.3] - 2026-07-16

Patch. Three field-reported fixes: the standalone binary finds its built-in templates, `kj update` updates the kj you actually run, and the osv-scanner go install recipe works.

### Fixed

- **Standalone binary ships its templates** (KJC-BUG-0104): the SEA binary carried no `templates/` — `kj init` warned `ENOENT: $HOME/templates/skills` and built-in role prompts, config-init and onboard templates were unreachable on fresh machines. Templates now travel as SEA assets (72 files) and are extracted once per version to `~/.karajan/embedded-templates/`; every consumer resolves through a single `getTemplatesRoot()`. npm installs keep reading the real `templates/` directory.
- **`kj update` is channel-aware and verifies the PATH** (KJC-BUG-0106): it always ran `npm install -g`, even on standalone-binary installs — npm updated a copy the PATH never resolves, the running binary stayed old, and the command still reported success. The sea channel now re-runs the binary installer (downloaded to a temp file, never piped into a shell), the registry lookup uses HTTP instead of `npm view`, and both channels end with a `kj --version` probe that fails loudly, naming the shadowing copy, when the reported version is not the target.
- **osv-scanner go install recipe fixed** (KJC-BUG-0105): `go install github.com/google/osv-scanner@latest` resolves the module but fails — the binary lives in the `cmd/` subpackage and since v2 the module path carries `/v2`. install-tools, the audit hint and the docs now point at `github.com/google/osv-scanner/v2/cmd/osv-scanner@latest`.

## [3.12.2] - 2026-07-16

Patch. **Fresh `npm install -g karajan-code` works again.** Since bundling was introduced (~v3.4.2), a fresh global install failed on every machine: npm nests all deps under `karajan-code/node_modules`, and bundle semantics mark that subtree as already-shipped, so npm skipped fetching `better-sqlite3` & friends — empty directories whose install scripts crashed. Local installs hoist and never hit it (that's why `verify-pack` stayed green), and upgrades reuse the existing tree (that's why `kj update` kept working).

### Fixed

- **Global install no longer breaks on fresh machines** (KJC-BUG-0103): the internal `@karajan/core` workspace is now published to npm as **`karajan-core`** and resolved from the registry like any other dependency; `bundleDependencies` is gone. Verified: fresh `npm install -g` on npm 10 and 11 now succeeds and `kj --version` boots.
- **E2E Install Test gives a real signal again** (KJC-BUG-0102): the workflow had been chronically red since v3.9.0 — its tarball was packed without the bundled core, and npm never fetches bundled deps from the registry, so `kj` died at startup. Removing the bundle removes the failure mode at the root.

### Infrastructure

- `verify-pack` gains a **global-install smoke** — the pre-publish gate now exercises `npm install -g` of the tarball, the exact path that was broken while every other gate stayed green.
- The `core-no-bundled-deps` architecture guard now also forbids reintroducing `bundleDependencies`.

## [3.12.1] - 2026-07-15

Patch. **`kj update` output is clean again.** A successful self-update now shows only the progress and result lines; npm's own noise — deprecation, allow-scripts and funding warnings — is build plumbing the user cannot act on, so it no longer reaches them.

### Fixed

- **`kj update` hides npm's warning noise on success** (KJC-TSK-0612): the command captured npm's output instead of streaming it (`stdio: "inherit"` is gone). On success you see `Current version → Updating → Updated to X`; on failure the captured stdout/stderr IS surfaced so real errors (native build, permissions) stay diagnosable — never a silent failure. Extracted into a testable `performSelfUpdate()` in `src/utils/update-check.js`.

## [3.12.0] - 2026-07-14

Minor. **`kj install-tools` now installs the tools kj itself needs**, not just the optional audit tools. A near-blank machine becomes operational with a single command — `git` and the default-pipeline agent CLIs (claude + codex) are treated as first-class required tools, exactly as `kj doctor` classifies them.

### Added

- **git as a required tool** (KJC-TSK-0611): `kj install-tools` installs git through the OS package manager (brew → apt → dnf → choco → scoop), reusing the shared install machinery. On Linux the privileged step runs through `sudo` on the user's own tty — kj never captures the password — and is opt-in, defaulting to no, with the exact command shown first. When no package manager matches, it surfaces the manual download URL rather than failing silently.
- **agent CLI as a required tool** (KJC-TSK-0611): `kj install-tools` installs the default-pipeline CLIs — claude (`@anthropic-ai/claude-code`) and codex (`@openai/codex`) — via global npm, installing only the ones that are missing. Both present ⇒ already-installed; if npm is absent it reports the concrete manual commands and URLs instead of failing silently. gemini stays out of the default (supported reviewer, not required).

## [3.11.0] - 2026-07-14

Minor. **`kj install-tools` now actually installs** — it is the actuator (installs the external audit tools), while `kj doctor` stays the diagnostician (tells you what's missing). Plus three reviewer/coder role refinements and two install-path fixes.

### Added

- **`kj install-tools` installs, not just advises** (epic KJC-PCS-0006): a wizard that shows the exact command for each tool and installs on accept.
  - **Sudo-capable executor + binary downloader** (KJC-TSK-0606): `runInstallCommand` runs privileged installs through `sudo` on the user's own tty — kj never captures or logs the password. `downloadBinary` fetches to a temp file, `chmod 0755`, then atomically renames, leaving no partial artifact on failure.
  - **Standalone binary route** (KJC-TSK-0607): on a machine with no package manager, osv-scanner installs from its GitHub static binary and semgrep falls back to a concrete Docker/pipx command — never a bare docs URL.
  - **Docker on Linux** (KJC-TSK-0609): opt-in (defaults to no), with the exact command shown first. Prefers the distro package manager (`apt` → docker.io, `dnf` → docker); otherwise downloads Docker's official convenience script to a file and runs it with sudo — never `curl | sh`. macOS/Windows point at the official docs (brew cask suggested on macOS).
  - **Clearer messaging** (KJC-TSK-0610): sonar states it runs as a Docker container and gives the concrete next step; tools with no package manager name the route and point at `kj doctor`.
- **Active partner — relevance-gated dissent** (KJC-TSK-0603): the coder and spec-reviewer surface a disagreement when it is materially relevant, instead of silently complying.
- **Check-alignment micro-gate** (KJC-TSK-0604): a lightweight alignment check for moderate/complex tasks.
- **Point the target** (KJC-TSK-0605): high-impact negative instructions are reworded affirmatively so the agent aims at the desired outcome.

### Fixed

- **RAG post-merge refresh honours `core.hooksPath`** (KJC-BUG-0100): `kj rag install-hooks` always wrote `.git/hooks/post-merge`, but a hardened repo sets `git config core.hooksPath .karajan/hooks` — git then ignores `.git/hooks/` entirely, so the RAG index silently never refreshed after a merge while the command still reported success. `installPostMergeHook` now resolves the effective hooks dir, installs there, and reports `covered` when another kj-managed hook (harden's own post-merge) already reindexes. New `kj doctor` check (`rag-hooks`) surfaces a WARN when the effective post-merge hook does not refresh the RAG; the pre-run drift check in `kj run` remains the backstop.
- **macOS installs the darwin-arm64 binary** (KJC-BUG-0101): the installer script did not select the macOS asset.

## [3.10.2] - 2026-07-13

Patch. Rolls up a privacy fix, a path-containment hardening and triage observability.

### Fixed

- **Personal email removed from public metadata** (#1156): a personal address had leaked into user-facing package metadata. Replaced with the public handle so scrapers can't harvest it.
- **Path guards use containment, not string prefix** (KJC-BUG-0098): direct-action file writes (`create_file`, `git_add`) confined the target to the project directory with a string-prefix check, which a sibling path like `../project-evil` could slip past. The guard now uses a `path.relative`-based containment test, so a crafted path cannot escape the repo.

### Added

- **Per-role triage rationale** (KJC-TSK-0601): triage decided which roles to activate but only exposed one global `reasoning` blob — the per-role *why* was invisible. Triage now emits a deterministic `roleRationale` (role, enabled, source, reason) mirroring the activation logic, rendered under the `triage:end` event so each activate/skip decision is observable. The rationale describes each role's trigger, never a per-task claim, so it is never invented; on triage failure, skipped roles degrade to a neutral reason.

### Docs

- **Recorded by-design non-goals** (KJC-TSK-0602): `docs/design-decisions.md` documents why `npm install` is not run with `--ignore-scripts`, why there is no built-in sandbox, and why there is no user-editable YAML/JSON config — so reviews stop re-proposing them.

## [3.10.1] - 2026-07-12

### Fixed

- **Standalone binary crashed on `kj run`** (KJC-BUG-0097): every SEA binary (Linux, Windows, macOS) booted fine (`--version` / `--help` / `init`) but died on the core command with `maybeAutoUpdate is not a function`. The SEA bundler stubs out `src/rag/*` to keep native SQLite deps out of the binary; `src/rag/auto-update.js` was caught by that filter, yet `run.js` calls its `maybeAutoUpdate()` on every run. The stub now re-exports `maybeAutoUpdate` as a silent no-op (RAG auto-update is unavailable in the binary anyway) so the command proceeds. The `sea-smoke` gate and `sea-build` test now exercise `kj run` — booting was never enough to prove the bundle wires up.

## [3.10.0] - 2026-07-12

Minor. **The macOS standalone binary now boots** — the first release to ship a working `darwin-arm64` executable, plus installer guidance for binary users (epic KJC-PCS-0006).

### Fixed

- **macOS SEA binary segfaulted on startup** (KJC-BUG-0096): the `darwin-arm64` build crashed with exit 139 the moment it launched, so no macOS binary could ship. `postject` on Mach-O needs `--macho-segment-name NODE_SEA` for the SEA blob to land where Node's loader looks for it; without it the blob went to a segment the loader never inspects. The flag is Mach-O-only (ELF/PE ignore it), so it's applied on macOS builds alone. Re-signing was already correct.

### Added

- **`sea-smoke.yml` CI harness** (KJC-BUG-0096): Node upstream only CI-tests single-executables on Linux, so a macOS startup crash could only surface at release time. A `macos-latest` job now builds the `darwin-arm64` binary and asserts it boots (`--version` / `--help` / `init --help`) on every change to the SEA build, catching regressions on the PR.
- **Installer points binary users at `kj doctor`** (KJC-TSK-0599): the standalone binary bundles its runtime but still orchestrates external tools (git, an agent CLI, optionally Docker). After a binary install the installers now tell the user to run `kj doctor` to check those prerequisites, instead of leaving them to discover a missing dependency mid-task.

### Changed

- **macOS install degrades to npm cleanly** (KJC-TSK-0598): while the `darwin-arm64` binary was unavailable, the Unix installer detected macOS and pointed the user to `npm install -g karajan-code` with a clear message rather than fetching a binary that wouldn't run. Superseded now that the binary boots, but the graceful-degradation path remains for any future gap.

## [3.9.0] - 2026-07-11

Minor. **Distribution as a standalone executable** — install `kj` on a machine with no Node at all, with the release pipeline hardened so a broken binary can never ship (epic KJC-PCS-0006).

### Added

- **Node-free binary installer for Unix** (KJC-TSK-0593): `curl -fsSL https://karajancode.com/install.sh | sh` downloads the prebuilt `kj` for your OS/arch (linux-x64, darwin-arm64), verifies its SHA256 before installing, and drops it in `~/.local/bin` (POSIX `sh`, no bashisms). `KJ_VERSION` / `KJ_INSTALL_DIR` override the defaults.
- **Node-free binary installer for Windows** (KJC-TSK-0594): `irm https://karajancode.com/install.ps1 | iex` does the same for `kj-win-x64.exe`, verifies the checksum, installs to `%LOCALAPPDATA%\Karajan`, and adds it to the user PATH idempotently (re-running updates in place without duplicating entries).
- **Channel-aware update notice** (KJC-TSK-0595): the "update available" banner now detects whether `kj` runs as a standalone binary (`node:sea`) or from npm and prints the matching command — re-run the installer for binaries, `npm install -g` for npm — instead of always suggesting npm.

### Changed

- **Binaries clear the OS block on install** (KJC-TSK-0596): the macOS build is ad-hoc signed and the Windows build unsigned (paid notarization/Authenticode remain a deliberate opt-in cost, off by default). The installers now strip the quarantine flag (`xattr` on macOS) and the mark-of-the-web (`Unblock-File` on Windows) on the copy they just checksummed, and the README documents the manual bypass for hand-downloaded binaries.

### CI

- **GitHub Release created from the CHANGELOG before the SEA upload** (KJC-TSK-0591): the `v*` tag triggers the binary build, but the upload needs the Release to already exist — the workflow now creates it from the matching CHANGELOG section first, closing the post-publish "run failed" gap.
- **SEA binary smoke-tested before its assets are uploaded** (KJC-TSK-0592): each built binary must boot (`--version` / `--help`) before it reaches the Release, so a broken executable is caught in CI rather than by the first user to download it.

## [3.8.0] - 2026-07-07

Minor. **`kj start`** — one entry point to the autonomous squad: the user states an intent (and at most the project's maturity) and the Brain does the rest, read-only, before proposing anything.

### Added

- **`kj start [intent]`** — the single door to the Brain (epic KJC-PCS-0061). The user never learns or invokes `doctor`/`check`/`harden`/`onboard`/`rag`/`qmd`; the Brain orchestrates them. A cheap AI layer **decides the WHAT** (a structured intent from a closed set) and KJ maps it to an existing saved command with **confirmation for anything that writes** — the model never runs commands on its own.
  - **Maturity classifier** (`src/start/maturity.js`, KJC-TSK-0568): infers `new | existing | legacy` from deterministic signals (scaffolding only, real code + tests + CI, or neglected health) to shape what gets proposed; the guess is confirmed with the user, never asked cold.
  - **Read-only sweep** (`src/start/sweep.js`, KJC-TSK-0568): runs the assessment commands without touching the user's code (init only ever writes `.karajan/`).
  - **Deterministic synthesis + decider role** (`src/start/assessment.js`, `src/start/start-decider-role.js`, KJC-TSK-0569): condenses the sweep into a stable report and asks the decider for the next intent.
  - **Orchestration loop + dispatch** (`src/commands/start.js`, KJC-TSK-0570): each writing intent maps to a saved command + args; degrades gracefully so `kj start` never crashes.
- **`kj advanced` command namespace** (KJC-TSK-0582): `kj --help` is trimmed to the core commands, with the full surface indexed under `kj advanced` and guarded by a help-parity gate.

### Security

- **Inbound secret redaction at the review boundary** (KJC-TSK-0583): a hardcoded credential in the working tree used to reach the (possibly cloud) reviewer model verbatim inside the diff. `src/guards/secret-redactor.js` now masks every secret before the model sees it, reusing the existing `CREDENTIAL_PATTERNS` catalog (deterministic, no AI cost, no-op on clean text). It preserves an identifiable prefix (`AKIA***REDACTED***`, `sk-ant-***REDACTED***`) so the reviewer can still flag "move this to .env" without seeing the value. Closes the inbound counterpart to the existing outbound (commit) secret guard.

## [3.7.2] - 2026-06-23

Patch. HU Board deep-link fix + resilient `kj audit` provider fallback.

### Fixed
- **`kj plan` printed a broken HU Board deep-link** (KJC-BUG-0093): the auto-start banner pointed at `http://localhost:4000/p/<slug>`, a path the SPA router doesn't recognise, so the user landed on the global "All projects" dashboard instead of their project. `buildBoardUrl` now emits the canonical hash route `http://localhost:4000/#board/<slug>` used by the frontend router. Fixes the URL for `kj plan`, `kj run` and auto-HU batch alike (single source of truth).
- **`kj audit` had no fallback when the configured provider/model was down** (KJC-BUG-0094): the CLI audit called `AuditRole.executeWithDeterministic` directly, bypassing the orchestrator's recovery paths, so a dead configured model (e.g. an inherited `claude-fable-5`) killed the command outright. The LLM phase now walks an ordered, de-duplicated candidate chain — configured provider+model → same provider default model → remaining known providers (claude, codex, gemini) — and the first success wins. Uninstalled CLIs are skipped without throwing, and the deterministic analysis context is collected once and reused across attempts.

## [3.7.1] - 2026-06-22

Patch. Onboarding and package-manager robustness.

### Fixed

- **`kj init` crash configuring Plan B** (KJC-BUG-0091): answering `y` to the fallback-chain prompt threw `wizard.input is not a function`. The interactive wizard never exposed an `input` method; added one (symmetric with `confirm`, with a `[default]` hint). Independent of the package manager.
- **pnpm installs left karajan unable to open its DB** (KJC-BUG-0092): pnpm blocks dependency build scripts by default, so `better-sqlite3`'s native addon never compiles — `kj --version` works (lazy) but any DB-backed command (`board`, `rag`, cost tracking) crashed with `Cannot find module 'better-sqlite3'`. `kj doctor` now detects the pnpm layout and surfaces the exact remedy (`pnpm approve-builds better-sqlite3`, or install with npm) instead of a cryptic crash.

### Changed

- **Release gate now checks pnpm** (KJC-TSK-0580): `verify-pack` additionally installs the tarball with pnpm and asserts `kj` boots under pnpm's symlinked store, so a pnpm packaging regression is caught every release (CI runs it via `corepack`). The native-build limitation is inherent to pnpm and is surfaced as the doctor warning above.

## [3.7.0] - 2026-06-21

Minor. **Autonomous delivery** — give Karajan a spec and it runs to completion unattended, resolving agent conflicts itself (epic KJC-PCS-0062).

### Added

- **`kj autorun <spec>`** — one command chains spec → plan → run every HU → outcome, defaulting to the autonomous level so no human is in the loop. Reuses `kj plan` and `kj run --plan`; propagates a non-zero exit code when HUs don't meet the ask (KJC-TSK-0574).
- **Autonomy levels** `interactive | assisted | autonomous` (`--autonomy <level>` / `--autonomous`, also on `kj run`). A single decision resolver routes every gate to the human or to the Arbiter depending on the level (KJC-TSK-0572).
- **The Arbiter** — an autonomous decision authority that resolves agent conflicts (reviewer vs coder, failing acceptance tests, ambiguous spec) by picking the **least-bad** verdict from a closed set (`ACCEPT_WITH_DEFECT` / `RETRY_DIFFERENT_APPROACH` / `DESCOPE_HU` / `BLOCK_AND_CONTINUE` / `PROCEED`), with the ground-truth order *acceptance tests > must-fix > nice-to-have*. Any parse failure degrades to the conservative verdict — it never crashes or blocks (KJC-TSK-0573).
- **Outcome report** — `kj autorun` ends with an auditable "meets the ask, with known defects" summary: DELIVERED/INCOMPLETE, which HUs met the ask, the Arbiter's decisions, and residual defects (KJC-TSK-0577).

### Changed

- In autonomous mode the spec-review gate and every pipeline stage no longer ask a human or block on the board — they auto-continue with the least-bad choice, and the wall-clock backstop is enforced for unattended runs so a run can't pause or run away (KJC-TSK-0572, 0576, 0575).

### Fixed

- `kj autorun` cost writes no longer fail with "Database not initialized", and the outcome report shows the real per-HU count instead of `0/0` — both found by live end-to-end runs (KJC-BUG-0090).

Verified live: `kj autorun spec.md --autonomous` plans, builds and tests a module with no human, ending DELIVERED. Scheduled auto-resume after a quota reset is a follow-up (KJC-TSK-0578).

## [3.6.0] - 2026-06-19

Minor. **Advisory harden** — `kj harden` learns to compare instead of just install, plus a rounder first-run and the ai-trash safety net actually reaching npm users.

### Added

- **Advisory mode for `kj harden`** (epic KJC-PCS-0060) — for an existing or legacy repo, see what the kj standard would add before touching anything:
  - **Comparison engine** (`src/harden/advisory.js`, KJC-TSK-0565): classifies every managed artifact (editorconfig, commitlint, eslint, prettier, per-language lint) as `MISSING`, `KJ_MANAGED` (up-to-date / outdated vN) or `USER_OWNED`, recognising equivalent formats (legacy `.eslintrc.*`, `.commitlintrc.*`, inline `package.json` keys) so it never reports a false "missing". For a user's own config it lists the concrete improvements kj would add (ES2025 ban, commitlint header/subject rules, prettier `printWidth`, editorconfig basics). Monorepo-aware.
  - **`kj harden --report`** (KJC-TSK-0566): read-only per-artifact report (and `--json`) of what's missing, what you have, and what kj would improve — honouring the same scope as an install.
  - **`kj harden --interactive`** (KJC-TSK-0567): adopt the standard piece by piece, default-safe (keep your own); without a TTY it falls back to seed-if-absent.
- **`kj harden` scope control** (KJC-TSK-0564): demo/fixture dirs (`examples`, `fixtures`, `samples`, `third_party`, `testdata`, …) are ignored by default, plus `--only <dirs>` / `--exclude <globs>` flags and per-repo defaults via `package.json` `kj.harden`.

### Changed

- **`kj init` first-run UX** (KJC-BUG-0087, KJC-TSK-0571, KJC-BUG-0088): no scope question on a true first run; advanced per-role agent routing collapsed behind one opt-in question; the wizard is now consistently English with glossed terms (triage, HU Board, user-story language); the Squeezr update banner no longer leaks into init output; and init ends with a clear "next step" close. `kj --help` surfaces the handful of commands a newcomer actually needs.

### Fixed

- **ai-trash safety net now ships to npm** (KJC-BUG-0089): the `kj-trash` binary (snapshots destructive ops) was never in the published tarball — absent from `files`, not a root bin. It's now packaged and exposed as a root bin, with the verify-pack gate extended to assert it links and boots so it can't regress.

Full test suite green on CI (Node 22.x + 24.x); verify-pack confirms a clean isolated install.

## [3.5.1] - 2026-06-14

Patch. PHP becomes a first-class language in the quality harness.

### Added

- **PHP support in `kj harden`** (KJC-TSK-0563): `detectStackRoots` now recognises `composer.json` → `php` (aligning the harden detector with `detectProjectStack`, which already knew it), and the harden maps gain PHP — native hook commands (`vendor/bin/phpstan analyse`, `php-cs-fixer fix --dry-run`, `vendor/bin/phpunit`), a `phpstan.neon` config (level 6) seeded as a `kj:managed` block, and a `setup-php` Quality CI workflow. A PHP repo is now hardened like JS/Python/Go — native tooling, no npm/Node imposed at commit time — and `kj check` inherits the PHP config drift checks automatically. The PHP RAG AST grammar (tree-sitter) is intentionally out of scope.

## [3.5.0] - 2026-06-14

Minor. **Quality harness** — `kj harden` + `kj check` (epic KJC-PCS-0059): the guardrails Karajan was built with, installable into any repo (new or existing) in one command, then verifiable as a CI drift gate.

### Added

- **`kj harden`** — installs the quality harness, idempotent and stack-aware, never overwriting content outside its `kj:managed` markers:
  - **Git hooks** under `.karajan/hooks/` via `core.hooksPath` (never fights husky/simple-git-hooks): pre-commit lint+format, commit-msg (Conventional Commits + 100-char cap + AI-attribution block — pure POSIX, no Node), pre-push tests + git-identity guard, post-merge reindex. **Native per-language commands** (`go vet`/`gofmt`/`go test`, `ruff`/`pytest`, npm scripts) so hardening a Go/Python/Java repo never makes Node a commit-time dependency (KJC-TSK-0555, 0562).
  - **Config** seeded if absent: `.editorconfig`, `commitlint.config.js`, and per-language lint/format — `eslint.config.js` with an ES2025 deprecated-API blacklist (`var`/`document.write`/`alert`/`escape`/`substr`…) + `prettier` for JS/TS, `ruff.toml` (pyupgrade) for Python, `.golangci.yml` for Go. In a fullstack monorepo each language gets its config inside its own root (KJC-TSK-0556, 0561).
  - **CI workflows**: a Block-AI-attribution gate, a stack-aware Quality workflow, plus shrink-budget (strict profile) and pack-smoke (publishable npm packages) (KJC-TSK-0557).
  - **Agent guidelines**: a distilled rule set seeded into `AGENTS.md`/`CLAUDE.md`, cleanly migrating any legacy dev-hooks block (KJC-TSK-0559).
  - Profiles `minimal`/`standard`/`strict`; opt-outs `--no-config`/`--no-ci`/`--no-guidelines`; `--dry-run`, `--json`.
- **`kj check`** — verifies the harness is present and intact (hooks executable + marked, `core.hooksPath`, config/workflows present), with exit 0/≠0 and `--json` for CI. Catches drift and the greenfield gap (a language added after hardening whose config was never seeded) with a run-`kj harden` hint (KJC-TSK-0558).
- **`kj init`** now installs the harness through the same engine, so init and harden share one source of truth (opt out with `--no-harden`) (KJC-TSK-0560).
- Managed-markers primitive (`src/utils/managed-markers.js`) — idempotent block upsert preserving everything outside the markers (KJC-TSK-0555).
- Documented in `docs/GETTING-STARTED.md` (EN + ES).

5 717/5 717 tests passing across 530 files.

## [3.4.2] - 2026-06-13

Hotfix: `npm install karajan-code@3.4.1` rompía en `kj --version`.

### Fixed

- **Install roto en 3.4.1 (Application Blocker)**: `@karajan/core/src/vec-store.js` importa `sqlite-vec`, que declara `files: []` en su package.json; al re-empaquetar `@karajan/core` vía `bundleDependencies` (fix de KJC-BUG-0082), npm arrastraba sqlite-vec respetando ese `files: []` y lo copiaba sin `index.mjs` → `ERR_MODULE_NOT_FOUND` en el arranque. Fix: las deps de runtime de `@karajan/core` (better-sqlite3, execa, sqlite-vec) pasan a `peerDependencies` — nunca se bundlean y resuelven desde el top-level del consumidor, completas y con el binario nativo correcto por plataforma. Las tres ya están declaradas en las dependencies raíz de karajan-code (KJC-BUG-0086). Test de regresión `tests/architecture/core-no-bundled-deps.test.js` lo congela.

## [3.4.1] - 2026-06-12

Hardening post-v3.4.0: los 3 bugs de observabilidad detectados durante la medición de Phase 1 + el top accionable del `kj audit` ejecutado con claude-fable-5.

### Fixed

- El session journal (summary.md con Cache hits, budget y commits) se escribe en TODOS los finales de run — sonar_repeat, stage error, throw — vía el writer único `session/journal/write-all.js` llamado desde el `finally` del flow-runner; antes solo el camino aprobado lo escribía y los runs fallidos perdían el post-mortem (KJC-BUG-0084, #1055).
- El rol audit propaga `cached_tokens` al BudgetTracker, a la tabla Cache hits y al informe de `kj audit` (línea "Cached tokens"); era el rol más caro de la sesión y reportaba 0 (KJC-BUG-0085, #1054).
- Preflight fail-fast `sonar-project-key`: cuando el remote git no es parseable y no hay `sonarqube.project_key`, el run aborta ANTES de la primera iteración con mensaje accionable en vez de quemar tokens y morir en `sonar_repeat`. Sonar sigue siendo obligatorio para tareas de código — contrato v2.7.4 intacto (KJC-BUG-0083, #1056).

### Changed

- `stripRuntimeOnlyKeys` sin `void _drop` — único CRITICAL S3735 del quality gate fuera (KJC-TSK-0535, #1053).
- Util compartido `escapeRegExp()` aplicado en toda interpolación de variables en `new RegExp()` — cierra los hallazgos detect-non-literal-regexp de Semgrep (KJC-TSK-0536, #1057).
- 23 dead exports podados (knip a 0) + `docs/audit-false-positives.md` documenta por qué las 6 deps raíz marcadas como "no usadas" son imprescindibles para el tarball npm (KJC-TSK-0537, #1058).
- 4 CRITICALs S2871 (sorts sin comparador) + 4 regex S5843 descompuestos (c71/c36/c31/c22) + cluster de ternarios/templates anidados extraído (KJC-TSK-0538, #1059).
- HU Board `api.js`: 0 llamadas fs síncronas en handlers (fs/promises + FileHandle) y cache mtime de plan JSON en los escaneos — el event loop deja de bloquearse y los polls no re-parsean todos los planes (KJC-TSK-0539, #1060).

5 638 tests en 517 ficheros.

## [3.4.0] - 2026-06-11

Cache propio cross-provider (epic KJC-PCS-0057 / Phase 1 closed). Los prompts de Karajan se reestructuran para maximizar el prompt-caching automático de cada provider: la medición real con Claude pasa de 47.2 % a 99.6 % de cache_pct en frío y el coste del coder cae un 76 %.

### Added

- `src/prompts/prompt-layout.js`: helper `buildPromptLayout`/`section`/`joinLayout` que separa cada prompt en bloque estable (idéntico entre iteraciones y HUs) y bloque volátil, con etiquetado explícito y sin fallbacks silenciosos (KJC-TSK-0527, #1044).
- Coder prompt cache-friendly: `buildCoderPromptLayout()` con secciones estables delante y volátiles al final preservando el orden relativo legacy (KJC-TSK-0528, #1045).
- Reviewer prompt cache-friendly: review rules y skills en el bloque estable; task + git diff (hasta 12 KB) como cola volátil (KJC-TSK-0529, #1046).
- Claude system-prompt split: con `stablePrompt`/`volatilePrompt` el agente envía `-p <volatile> --append-system-prompt <stable>` — el CLI cachea el system block con breakpoints y Anthropic sirve el contenido estable desde cache en cada iteración (KJC-TSK-0530, #1047).
- Architect, HU-reviewer y el builder inline de ReviewerRole migrados al layout estable; el split de Claude aplica también a todas las reviews del loop (KJC-TSK-0531, #1048).
- Suite de regresión prefix-stability: LCP inter-iteración e inter-HU = 100 % del bloque estable, mínimo de 1024 tokens del prefix caching de OpenAI verificado, y marcadores volátiles que nunca se cuelan en el bloque estable (KJC-TSK-0532, #1049).
- `docs/phase-1-cache-propio.md`: análisis completo de la fase + resultados de la medición real (KJC-TSK-0533, #1050).

### Measured

- Claude coder cold: cache_pct 47.2 % → **99.60 %**; coste $0.6141 → **$0.1447** (−76 %). Hot: 94.3 % → 99.69 %. Ambos runs APPROVED + audit CERTIFIED (2026-06-11).
- Incidencias de entorno registradas durante la medición: KJC-BUG-0083 (sonar no desactivable por config/flag), KJC-BUG-0084 (summary.md no se escribe en runs fallidos), KJC-BUG-0085 (rol audit sin cached_tokens).

5 624 tests en 514 ficheros.

## [3.3.0] - 2026-06-09

Cross-provider cache observability (epic KJC-PCS-0056 / Phase 0 closed).
Karajan now measures, persists and surfaces provider-level prompt-cache hits
end-to-end across Anthropic, OpenAI/Codex, Gemini, aider and opencode. The
same `cached_tokens` field flows from agent → BudgetTracker → summary.md →
`board.db` → HU Board UI badge `🎯 N%` → telemetry `pipeline_complete`.
**No breaking changes** — every new field is null-safe (badge hides when
unmeasured rather than showing a misleading `🎯 0%`).

### Added

- **Φ0-A — claude cache_read/creation tokens passthrough** (KJC-TSK-0519,
  v3.2.x backport on main) — extracts `usage.cache_read_input_tokens` and
  `usage.cache_creation_input_tokens` from the Anthropic response into the
  unified BudgetTracker `cached_tokens` slot.
- **Φ0-B — codex cache_tokens passthrough** (KJC-TSK-0520) — reads
  `usage.prompt_tokens_details.cached_tokens` from the OpenAI/Codex wire
  format. Covered by `tests/agents/codex-cache-passthrough.test.js`.
- **Φ0-C — gemini cachedContentTokenCount via usageMetadata** (KJC-TSK-0521)
  — extracts Google's native cache field. Project-level system-prompt cache
  is already warm in cold runs, observed at 87.9% on real data.
- **Φ0-D — aider+opencode passthrough via LiteLLM** (KJC-TSK-0522) — both
  CLIs route through LiteLLM, which normalises `usage.cached_tokens` so
  Karajan reads a single shape regardless of upstream provider.
- **Φ0-E — BudgetTracker cursor-snapshot cached accumulation** (KJC-TSK-0523)
  — `computeUsage()` collapses all five provider fields into one
  `cached_tokens` value and `summary()` exposes per-role `cached_tokens` /
  `tokens_in` in `breakdown_by_role`.
- **Φ0-F — summary.md `## Cache hits` section** (KJC-TSK-0524) — per-role
  table with cached tokens, ratio, and estimated savings. Renders
  `_Cache hits: 0 tokens (cold run)._` instead of an empty table when no
  cache fired.
- **Φ0-G — HU Board cached % badge** (KJC-TSK-0525) — three PRs:
  `cached_tokens`/`tokens_in` columns on `stories` (board.db migration),
  orchestrator propagation to HU outcome, and `formatCacheRatio()` rendering
  `🎯 N%` on card + project header with hover tooltip. Hidden when no
  signal (same stance as Cost F).
- **Φ0-H — telemetry `cached_pct_{coder,reviewer,total}`** (KJC-TSK-0526) —
  `computeCachedPct(summary)` aggregates from `BudgetTracker.summary()` and
  is folded into the opt-in `pipeline_complete` event. Per-role nulls
  preserved so the backend can distinguish "no cache" from "no signal".

### Notes

- **Real data collected** (2026-06-09, local sandbox):
  - Claude cold→hot: 47.2% → 94.3% cache_pct ($0.6141 → $0.1452,
    **76.4% cost savings** on a single HU).
  - Gemini cold→hot: 87.9% → 96.8% cache_pct.
  - Codex: shape verified via unit tests; live E2E blocked by its own
    bubblewrap kernel-namespace permission on this host (OS issue, not
    Karajan).
- Provider-agnostic by design: `BudgetTracker` never branches on which
  provider produced the run; the 5 paths converge on one normalised field.
- Telemetry remains opt-in (`telemetry: true` in `.karajanrc`); the new
  cache fields ride the existing endpoint.

## [3.2.0] - 2026-06-07

Cost tracking end-to-end (epic KJC-PCS-0055 closed). Every HU run now
records its USD spend; the HU Board surfaces it as a per-card badge and a
project total chip. **No breaking changes** — `cost_usd` is additive and
null-safe (badge hides when unmeasured, never "$0.00" by mistake).

### Added

- **Cost A — model pricing registry** (KJC-TSK-0512) — `model-pricing.json`
  with input/output USD-per-token for Claude, GPT, Gemini, local models.
  Versioned, lookup is exact-match then prefix fallback.
- **Cost B — cost aggregator** (KJC-TSK-0513) — `aggregateRunCost()` reduces
  a list of `BudgetTracker` entries into `{totalUsd, byModel, byProvider,
  unknownModelTokens}`. Unknown models surface their token counts so the
  user knows what's missing pricing.
- **Cost C — board.db schema** (KJC-TSK-0514) — idempotent migration adds
  `cost_usd REAL` column on `stories`. NULL = unmeasured, 0 = free run.
- **Cost D — orchestrator → board write** (KJC-TSK-0515) — per-HU cost is
  sliced from the session `BudgetTracker` via cursor snapshot (entries at
  HU-start vs at HU-end) and persisted to `board.db` through
  `setLiveOutcomeUpdater`. Lazy import of hu-board keeps the pre-loop free
  of board deps until needed.
- **Cost E — `/api/projects/:id/cost`** (KJC-TSK-0516) — returns `{totalUsd,
  byPlan, unknownModelTokens, currency}` for a project. Aggregates across
  all plans, isolates unknown-model token leakage.
- **Cost F — HU card badge** (KJC-TSK-0517) — `formatCost(cost_usd)` renders
  `$0.02` label + `Estimated cost: $0.0234` tooltip. Hidden when null.
- **Cost G — project total chip** (KJC-TSK-0518) — `formatProjectCostSummary`
  builds a header chip with per-plan breakdown. Hidden when nothing to show.
- `kj doctor` and `kj init` ai-trash integration (KJC-TSK-0391). Doctor
  surfaces a WARN when `kj-trash` is missing on PATH (destructive ops
  unprotected). Init now auto-registers the Claude Code PreToolUse hook via
  `kj-trash install --claude-code` when the binary is present; opt-out via
  `--no-ai-trash`. Follows the RTK/Squeezr default-on pattern.

### Notes

- Null vs 0 semantic preserved end-to-end: `BudgetTracker` empty → outcome
  null → board.db NULL → UI hides badge. A measured free run still renders
  `$0.00`.
- `BudgetTracker` is session-scoped; the cursor-snapshot pattern
  (`entries.slice(huBudgetStartIdx)`) isolates per-HU spend without losing
  cumulative totals.

## [3.1.0] - 2026-06-05

First minor on the v3 line. Bundles five tracks of work landed since v3.0.0:
quality gates (tool-correctness judge, TDD-discipline), housekeeping (`kj clean`,
`kj sync --apply`), HU Board structural refactor, semantic test-diet auditor,
and a batch of security/test-stability fixes. **No breaking changes** — drop-in
upgrade from 3.0.0.

### Added

- **Tool-correctness judge** (KJC-TSK-0375) — new role + stage wired into
  quality-gates. Extracts tool calls from agent transcripts and judges whether
  the coder used the right tools for the job. Three PRs: role/prompt (#964),
  tool-call extractor (#965), stage wiring (#966).
- **TDD-discipline gate** (KJC-TSK-0398) — pipeline stage that verifies tests
  were written before the implementation (surgical stash + diff inspection).
  Module (#957), stash helper (#958), pipeline wiring (#959).
- **`kj clean` family** (KJC-TSK-0499) — three new flags: `--repo` (stale
  branches, dist, tmp candidates, #930), `--vector-stores` (orphan RAG indexes,
  #931), `--all` paraguas with `docs/CLEANUP.md` (#932).
- **`kj sync --apply`** (KJC-TSK-0348) — canvas drift patch writer with backup;
  closes the SPDD sync loop (#967).
- **Semantic test-diet auditor** (KJC-TSK-0345) — `scripts/audit-test-diet.mjs`
  + `npm run audit:test-diet`. Five loss-of-meaning categories: empty-no-expect,
  skipped-pending, imports-orphan, deprecated-export, subsumed-candidate. Used
  to verify the 498-test suite has 0 findings (#968, #969).
- **HU Board canonical statuses** (KJC-TSK-0394) — API now only accepts
  canonical status names; legacy values trigger a suggestion (#962).
- **Public Planning Game link** in EN+ES READMEs (#934).

### Fixed

- **Prototype-pollution guards** in `setDeep`/`setDotPath` (KJC-BUG-0076, #933).
- **Harness scorecard** misclassified Docker failures (KJC-BUG-0077, #935).
- **ollama-capability** freemem assertion flake (KJC-BUG-0078, #939).
- **hibernate e2e** clock pin for quota test (KJC-BUG-0079, #963).
- **vitest tmp dirs** now cleaned on exit (KJC-BUG-0075, #929).

### Refactor

- **HU Board structural split** (KJC-TSK-0501) — `packages/hu-board/public/app.js`
  decomposed into `utils/` modules: formatters, modals, api, sessions-view,
  board-view, dashboard/graph views, story detail + project picker, preflight
  + log panel + plan rollup, HU action handlers, project actions modal, story
  edit form, config editor, command launcher, preflight + run launcher,
  server-push updates, initialization listeners, pointer-comment prune. 17 PRs
  (#936–#954).

### Documentation

- **`kj doctor` redesign spike** — system/project split + atomic plan
  (KJC-TSK-0416, #960).
- **ai-trash fase 1 informe técnico** (KJC-TSK-0386, #956).
- **README author + npm package count** (#928).

### Stats

- 498 test files, 5300+ tests passing.
- 39 commits, 0 breaking changes.

## [3.0.0] - 2026-06-03

**BREAKING — Node 22+ required.** Karajan v3 drops Node 20 (EOL 2026-04-30) and aligns
with the Active LTS line. Three dependency majors forced the bump: `lint-staged 17`
requires Node 22, `commander 15` requires Node 22.12, and `better-sqlite3 12.10` removes
prebuilt binaries for Node 20. Rather than ship four staggered minors each papering over
one constraint, we cut a single major that bundles the runtime move with the dep majors
that depend on it.

This release contains **no public API changes**. If you were already on Node 22.22.1+ and
your `~/.karajan/` works, your usage is identical. `kj run`, `kj plan`, MCP tools, role
templates, RAG, HU Board, audit, telemetry: all unchanged.

### Migration

```bash
nvm install 22.22.1 && nvm use 22.22.1
npm install -g karajan-code@3
kj doctor                     # verifies runtime + HW + tooling
```

If `nvm` is not available: install Node 22 LTS from <https://nodejs.org> and re-run
`npm install -g karajan-code`. Existing `~/.karajan/` (sessions, plans, RAG index,
audit history, HU board DB) is forward-compatible — nothing to migrate by hand.

### Changed

- **PR #918 (KJC-TSK-0500) — `engines.node` 20.10 → 22.22.1**. Drops Node 20 from
  the support matrix. CI matrix narrowed to Node 22.x + Node 24.x. Postinstall + doctor
  print a friendly hard-fail message on Node < 22.22.1 instead of a confusing native-module
  crash. Updates the install hint in the README banner and `docs/GETTING-STARTED.md`.
- **PR #920 (KJC-TSK-0491) — `lint-staged` 16 → 17**. New major requires Node 22+
  (matches v3 engines bump). No behaviour change for the `lint-staged` config Karajan
  ships under `.husky/`. Local pre-commit hook output is unchanged.
- **PR #922 (KJC-TSK-0490) — `commander` 14 → 15**. New major requires Node 22.12.
  CLI surface (`kj …` parsing, `--help` output, sub-commands) is unchanged. `kj rag`,
  `kj plan`, `kj run`, `kj audit`, `kj doctor`, `kj telemetry` all confirmed against
  the integration suite.
- **PR #923 (KJC-TSK-0488) — `better-sqlite3` 11 → 12 (12.10.0)**. Drops Node 20
  prebuilds upstream; adds Node 26 prebuilds; SQLite 3.53.1. Both root and
  `packages/hu-board/` lockfiles updated so the HU Board DB (`board.db`) and the RAG
  vec store (`vec.db`) load the same native binding.

### Documentation

- **PR #926 (KJC-TSK-0202) — Footprint & hardware requirements section in README**.
  Three sub-tables (per-layer sizes, three install profiles, HW targets) plus operational
  notes so adopters know what they sign up for before installing: kj npm ~5.2 MB,
  `~/.karajan/` ~40 MB, Ollama Docker 6.55 GB (opt-in), SonarQube 1.47 GB (opt-in),
  qmd cache ~2.2 GB (opt-in). Three profiles: Minimum ~250 MB / Recommended ~8.5 GB /
  Full ~11 GB. Cross-linked from `docs/GETTING-STARTED.md` (EN + ES).

### Why a major?

Semver: changing the minimum Node version is a breaking change for downstream
consumers, period. Even though no public API is removed, an install on Node 20 used
to work and now hard-fails. The three dep majors riding along (commander, lint-staged,
better-sqlite3) each individually qualify under their own semver as well. Cutting one
v3.0.0 surfaces the runtime move once instead of four times.

## [2.34.0] - 2026-06-01

Minor release. Two epics close in a single window:

- **KJC-PCS-0052 "Multi-language RAG"** — Python, Rust, Go and Java join JS/TS as first-class citizens of the local RAG index (AST chunkers + watcher + audit/onboarder multi-stack) so a polyglot repo gets the same semantic retrieval surface as a single-language one.
- **KJC-PCS-0053 "RAG Quality & Observability"** — a frozen golden-query harness (`kj rag eval`) puts a recall@k + MRR number on the retriever, content-hash dedup + MMR diversification tighten what gets returned, and `docs/RAG.md` gains a "six-questions" deep-dive that documents the system end-to-end.

The `kj rag index` command also picks up a `--since <ref>` switch + post-merge git hook so the index re-syncs on `git pull` / merge without manual intervention.

### Added

- **PR #882 (KJC-TSK-0455 PR1) — `vec_store_meta` table + `kj rag index --since <ref>`**. The vec store now stamps the last indexed commit per project. `--since auto` resolves to that stamp and only re-indexes paths returned by `git diff --name-only <sha>...HEAD`; an explicit ref is honoured as-is; missing baseline falls back to a full index with a friendly warning. Idempotent: `deleteChunksForSource` runs before re-embedding.
- **PR #883 (KJC-TSK-0455 PR2) — Post-merge hook + pre-run drift check**. New `kj rag install-hooks` writes `.git/hooks/post-merge` so `git pull` / merge auto-trigger a delta re-index. Pre-run drift check before every `kj run` compares `HEAD` to the last indexed SHA and emits a one-line hint when drift exceeds N files. Opt-in (the hook write is explicit, the check is silent unless drift is found).
- **PR #884 (KJC-TSK-0474) — Language adapter registry + Python canary**. New `src/lang/registry.js` exposes `adapterForPath(file)`; the indexer + watcher route every chunker call through it. Python lands as the first non-JS adapter (`src/lang/chunk-python.js`) so the shape of the registry is exercised by a real consumer from day one.
- **PR #885 (KJC-TSK-0475) — Python regex chunker**. Scope-reduced regex pass for Python (function / class / decorators + module docstring) that ships well-behaved fallback chunks while the AST adapter is being built. Lives behind the registry so the upgrade in PR #886 is a one-line swap.
- **PR #886 (KJC-TSK-0478) — Python AST chunker (web-tree-sitter)**. Replaces the regex pass with a tree-sitter walker (`function_definition` / `class_definition` / `decorated_definition` + docstring extraction). Grammar vendored under `vendor/tree-sitter-grammars/tree-sitter-python.wasm` so SEA binaries stay self-contained. Common contract preserved: `{ text, metadata: { source, kind, symbol, language } }`. Regex fallback retained for grammar-load failures.
- **PR #888 (KJC-TSK-0479) — Rust AST chunker (web-tree-sitter)**. Tree-sitter walker (`function_item` / `struct_item` / `enum_item` / `impl_item` / `trait_item`) + regex fallback for `fn` / `impl` / `struct`. Module-level doc comments captured; `impl` blocks emit per-method chunks with `Type::method` symbols.
- **PR #889 (KJC-TSK-0480) — Wire `preparePython` / `prepareRust` in indexer**. Indexer's `prepareAdapters()` now awaits the Python and Rust grammar loads before walking the project so the first file doesn't pay the cold-load tax mid-batch. Cached after first load via `src/lang/tree-sitter-loader.js`.
- **PR #890 (KJC-TSK-0481) — Go AST chunker (web-tree-sitter)**. Tree-sitter walker (`function_declaration` / `method_declaration` / `type_declaration`) + regex fallback. `(receiver) Method` symbols rendered explicitly so retrieval surfaces method-vs-function disambiguation without re-parsing.
- **PR #891 (KJC-TSK-0476) — Multi-stack manifest sniffer for `basal-cost`**. `kj audit`'s deterministic cost collector now reads Python (`pyproject.toml`, `requirements*.txt`), Rust (`Cargo.toml`), Go (`go.mod`) and Java (`pom.xml`, `build.gradle*`) manifests alongside `package.json`. Token / cost estimates no longer assume the repo is JS/TS.
- **PR #892 (KJC-TSK-0477) — Multi-stack frameworks + manifests in audit bundle**. The audit bundle JSON gains a `stacks` field listing every detected language stack with its framework hints (Django, Flask, Actix, Tokio, Gin, Echo, Spring, Quarkus...) and manifest paths. Onboarder + audit role consume it so the architecture brief / audit verdict reflect the real polyglot mix.
- **PR #893 (KJC-TSK-0486) — Java AST chunker (web-tree-sitter)**. Two-level tree-sitter walker (class / interface / enum / record → method / constructor) + regex fallback. Inner classes flattened with `Outer$Inner` symbols; annotations preserved in the chunk header for retrieval.
- **PR #894 (KJC-TSK-0485) — `docs/RAG.md` six-questions deep-dive**. Documentation rewrite covering the six retrieval questions end-to-end: chunking (per-language adapter table), embedder (six-provider matrix + cost/quality trade-offs), search (two-stage + hybrid + rerank + metadata filter), update strategy (manual / watcher / hook / drift check), what gets embedded (text-only + project isolation), validation (pipeline tests + golden-query harness). Excluded from the shrink-budget gate.
- **PR #895 (KJC-TSK-0482) — Watcher matcher derived from language registry**. `kj watch` no longer hard-codes `*.js`, `*.ts`, `*.tsx`, `*.jsx`. The chokidar matcher is built at startup from `src/lang/registry.js` extensions so Python / Rust / Go / Java sources trigger live re-index too. `--with-sources` honours the same set.
- **PR #896 (KJC-TSK-0484 PR-A) — Content-hash skip-on-match in indexer**. Each chunk row gains a `sha256` column; before embedding, the indexer hashes the canonicalised text and skips the Ollama call when the hash already exists for the same source. Re-indexing identical files now costs zero embeddings. `deleteChunksForSource` still runs first to keep idempotence.
- **PR #898 (KJC-TSK-0484 PR-B) — MMR diversification in retriever**. Optional `rag.search.mmr` knob enables Maximal Marginal Relevance over the top-N candidates. Lambda (`rag.search.mmrLambda`, default 0.5) trades pure cosine relevance for diversity, so a query that hits five near-duplicate chunks returns five *different* chunks instead. Off by default — opt in per project.
- **PR #899 (KJC-TSK-0483 PR-A) — Retrieval-quality harness + golden queries**. New `src/rag/eval.js` exposes a pure `runEval(queries, runQuery, { topK, ks })` that scores recall@k (binary) + MRR (mean of `1 / firstRelevantRank`) over a JSON list of golden queries. `tests/rag/golden-queries.json` ships 20 entries covering the public surface of `src/rag/` (vec-store, retriever, indexer, chunker, every embedder, watcher, where-parser, ollama-manager). Pure module so the math has its own unit tests.
- **PR #900 (KJC-TSK-0483 PR-B) — `kj rag eval` CLI + baseline docs section**. New `kj rag eval` subcommand wires the harness to the indexed corpus, emits aggregate `recall@5 / recall@10 / MRR` + per-query report (human or `--json`), and sets `process.exitCode = 1` when `--min-recall <n>` is configured and the aggregate falls below the threshold — drop-in CI gate after `kj rag index`. `docs/RAG.md` gains a "Retrieval quality baseline" section documenting the harness, query-matching semantics and intended CI usage.

### Tests

5 368 / 5 368 passing across 482 test files.

## [2.33.0] - 2026-05-28

Minor release. **AI Harness Scorecard golden metric (KJC-PCS-0051, Plan B)** — the four cards close the loop opened in v2.32.0 (Plan A hardening): every `kj audit` now boots a Docker one-shot of `addyosmani/ai-harness-scorecard`, gets a deterministic 0–100 score + A–F grade, persists it to a per-project `audit-history.db`, and on the next run renders the delta vs the previous baseline plus an optional Unicode-bar trend sparkline. Karajan finally has a single golden metric for "how AI-friendly is this repo today vs last week," with zero LLM tokens spent.

### Added

- **PR #877 (KJC-TSK-0470) — Bootstrap `ai-harness-scorecard` Docker one-shot**. New `src/audit/harness-runner.js` runs `docker run --rm -v <repo>:/repo addyosmani/ai-harness-scorecard analyze` with a 5-minute timeout, parses the JSON verdict, and surfaces it as a structured object. Auto-skipped (graceful degradation) when Docker is unreachable. CLI flag `--no-harness` opts out. Image is pulled lazily on first use; subsequent runs are cached.
- **PR #878 (KJC-TSK-0471) — `kj audit` integrates harness score**. New `src/audit/harness-section.js` renders the harness result as a Markdown section (overall score + per-category breakdown + grade badge), woven into both the deterministic-only path and the post-LLM report path of `kj audit`. JSON output gets a `harnessScore` field. Two-phase audit honored: the harness runs during the deterministic phase, so `--deterministic-only` users get it too.
- **PR #879 (KJC-TSK-0472) — Persistent per-project audit history**. New `src/audit/audit-history.js` opens `.karajan/audit-history.db` (better-sqlite3, WAL mode, `PRAGMA user_version=1`) per project root and persists every audit run's harness score, grade, category breakdown, git SHA and ISO timestamp. SEA bundle is patched with `auditHistoryStubPlugin` (same pattern as the existing rag-stub + hu-board-stub) so the standalone binary degrades gracefully — `npm install -g karajan-code` is the install path that unlocks history.
- **PR #880 (KJC-TSK-0473) — Diff vs previous run + trend sparkline**. New `src/audit/audit-history-display.js` (pure module, no native deps, safe in the SEA bundle) exposes `computeHistoryDiff` (overall delta + per-category deltas + biggest improvement/regression + stale-baseline flag at >30 days) and `formatTrendSparkline` (Unicode block bars `▁▂▃▄▅▆▇█` over the last N runs). The history block is appended to every `kj audit` report (Markdown + JSON), and the optional `--trend` flag prints the sparkline. First-run baselines render a friendly "no baseline yet" line instead of an error.



Minor release. **AI Harness Scorecard hardening (KJC-PCS-0051)** — Plan A closes five FAILs from the external scorecard audit in a single sprint: Prettier check, Coverage v8 reports, Conventional Commits enforcement, nightly drift detection, and unsafe-code lint policy. Two bug fixes ship alongside: 42 broken tests on `main` restored and a `spec-reviewer` refine-loop async bug.

### Added

- **PR #868 (KJC-TSK-0464) — Prettier `--check` CI job**. New `format` job on the CI workflow blocks PRs whose formatting drifts from `.prettierrc.json`. Scope intentionally narrow at first (`.github/workflows/`, root config) per `.prettierignore`; future PRs fold in additional directories under the shrink-budget cap.
- **PR #870 (KJC-TSK-0465) — Coverage v8 report + CI artifact**. `vitest.config.js` now emits `text + html + lcov` via `@vitest/coverage-v8`. New `coverage` job in CI runs `npm run test:coverage` and uploads `coverage/` as a downloadable artifact (14-day retention). Per-glob thresholds enforced when the user opts in. `src/mcp/handlers/**` floor ratcheted to `70/60` (was 80/80) to lock the current state — follow-up tracked to climb back.
- **PR #872 (KJC-TSK-0466) — Conventional Commits on PR head**. `wagoid/commitlint-github-action@v6` checks every PR commit message against `.commitlintrc.json`. Adds CI-side enforcement on top of the existing pre-commit local hook — a developer who bypasses husky still gets caught at the gate.
- **PR #873 (KJC-TSK-0467) — Nightly drift workflow**. New `.github/workflows/nightly.yml` runs the full CI suite (lint + syntax + tests + format) every night at 04:17 UTC against `main`. Failures auto-file/update a tracking issue tagged `drift` via `actions/github-script@v8`, so a flaky dep or upstream regression surfaces within 24 h instead of on the next unrelated PR.
- **PR #874 (KJC-TSK-0468) — `eslint-plugin-security` policy**. `eslint.config.js` now blocks `eval`, `new Function`, `Function`-style implied evals, dynamic `require`, `pseudoRandomBytes` and `mustache`-escape disabling as hard errors; flags `detect-non-literal-regexp` as warn (14 acceptable warnings noted for follow-up). High-signal members of the recommended preset are intentionally NOT enabled (`detect-object-injection`, `detect-non-literal-fs-filename`, `detect-child-process` would flood the orchestrator with false positives on legitimate fs / execa calls).

### Fixed

- **PR #869 (KJC-BUG-0065) — 42 failing tests on `main` repaired**. Tests broken by drift across multiple modules restored to green. The whole hardening sprint sits on top of a clean `main` again.
- **PR #871 (KJC-BUG-0066) — `await openEditor` in spec-reviewer refine-loop**. `src/spec-review/refine-loop.js` was firing the editor without awaiting it; under `--task-file` mode the SHA hash diff read the v2 contents before the user finished editing, falsely reporting `hashChanged: false`. The async call is now awaited end-to-end.
- **KJC-BUG-0067 — `tests/e2e/07-kj-audit.test.js` second `it` flaky on Node 20.x runners**. The "logger banner contamination" pin was timing out at 60s on Node 20.x GHA runners (Node 22.x stayed under 30s). Aligned the `runKj` `timeoutMs` (60 000 → 120 000) and vitest test timeout (90 000 → 180 000) with the heavier e2e tests in the same file.
- **KJC-BUG-0068 — RAG dashboard 500 on legacy `rag.db` schema**. `GET /api/rag/stats` was crashing with `no such column: project_slug` when the local DB predated KJC-TSK-0438 (v2.27.0). The readonly handler cannot run the `ALTER TABLE` migration, so the dashboard at `/rag.html` stayed permanently broken for any user with a pre-v2.27 DB. Fixed defensively: detect the column via `PRAGMA table_info` and return `by_project=[]` + `schema_legacy=true` when absent. Regression test added.
- **KJC-BUG-0069 — HU Board Settings modal: alpha spinbutton invalid (`stepMismatch`)**. The "Alpha del modo hybrid (0-1)" field arrived without an explicit `step`, so HTML5 applied `step=1` by default and refused the schema's `0.6` default with `validity.stepMismatch=true`, breaking save. Fix lives in two layers so future fractional defaults Just Work: declared `step: 'any'` in the `ragSearchAlpha` schema (`config-yaml.js`) and propagated `f.step` through the number-input template in the renderer (`public/app.js`).
- **KJC-BUG-0070 — `kj rag query --mode` crashed on first call (`review_mode must be one of: paranoid | strict | …`)**. The subcommand declared `--mode <mode>` (hybrid|semantic|keyword) for the RAG fuse strategy, but the global override pipeline maps `flags.mode → out.review_mode` and the schema validator rejected `"hybrid"` as a review mode, killing the command before the handler ran. Renamed the option to `--rag-mode` to escape the collision; the handler still receives the value under `flags.mode` (rebound + scrubbed before `withConfig`) so internal callers are untouched.

### Security

Caught by the pre-release `kj audit --yes` pass against this very branch (eating our own dog food). Two CRITICAL + two HIGH findings, all four fixed in-place before publish — patches are for issues discovered AFTER release, not before.

- **KJC-BUG-0071 — Dockerfiles ran as root (kj + hu-board, CRITICAL × 2)**. The `Dockerfile` (CLI image) and `packages/hu-board/Dockerfile` (board image) shipped without a `USER` directive, so the ENTRYPOINT/CMD inherited UID 0. With the typical `docker run -v $PWD:/workspace`, an exploit inside the container — or any CVE in a transitive dep — would write back to the host as root. Fixed by creating non-root accounts (`kj` for the CLI image, the prebuilt `node` user for the board), `chown`-ing the writable directories (`/workspace`, `/app`, `/data`), and dropping privileges before the process starts. Detected by semgrep `dockerfile.security.missing-user-entrypoint` and `dockerfile.security.missing-user`.
- **KJC-BUG-0072 — GitHub Actions: `${{ github.* }}` interpolated inside `run:` blocks (HIGH × 2)**. Both `.github/workflows/injection-guard.yml` and `scripts/ai-attribution-guard.yml` fire on `pull_request` (which includes fork PRs) and built shell commands by direct interpolation of `${{ github.base_ref }}` and `${{ github.event.pull_request.number }}`. A maliciously named base ref or PR number from a fork could inject commands into the runner. Fixed by moving each value into a step-scoped `env:` block and referencing `"$BASE_REF"` / `"$PR_NUMBER"` in the shell — the GitHub Security Hardening recommended pattern. Detected by semgrep `yaml.github-actions.security.run-shell-injection`.

### Tests

5 238 / 5 238 passing in CI across 461 test files.

## [2.31.0] - 2026-05-26

Minor release. **Team-shared HU Board** — landing the full KJC-PRP-0002 prerequisite: plans can now opt-in their HUs into a `.karajan-shared/` cohort that the board surfaces with a `shared` badge, lets multiple machines work the same plan without trampling each other, and tracks who owns each HU.

Seven PRs ship the feature end-to-end (PR1a loader fallback, PR1b `kj plan share`, PR2 board scanner, PR3 `kj plan unshare` + UI badge, PR4 `share --only/--exclude` HU filter, PR5 conflict policy, PR6 per-HU assignee).

### Added

- **PR #859 (KJC-PRP-0002 PR1a) — `loadPlan` fallback to `.karajan-shared/`**. The loader now resolves a plan id by trying the local `~/.karajan/plans/<project>/` first, then `<projectDir>/.karajan-shared/plans/<project>/`. Shared plans become first-class citizens for every code path that reads a plan (board sync, `kj plan show`, MCP).
- **PR #860 (KJC-PRP-0002 PR1b) — `kj plan share` command**. New subcommand copies a local plan into `.karajan-shared/plans/<project>/`, marking it as team-shared. Idempotent — re-running on an already-shared plan updates the copy with the local edits.
- **PR #861 (KJC-PRP-0002 PR2) — board scans `.karajan-shared/`**. `syncDb` and the file watcher now walk both `~/.karajan/plans/` and every detected `.karajan-shared/plans/` under the active project roots. Shared HUs flow into the same `stories` table tagged with `is_shared = 1`.
- **PR #862 (KJC-PRP-0002 PR3) — `kj plan unshare` + shared badge**. Mirror of PR1b: removes the shared copy and reverts the plan to local-only. The HU Board renders a small `shared` pill next to plan titles whose `project.is_shared = 1`.
- **PR #863 (KJC-PRP-0002 PR4) — `kj plan share --only/--exclude` HU filter**. Selective sharing: `--only HU-001,HU-003` shares just those HUs; `--exclude HU-005` shares everything else. Lets users keep WIP HUs private without splitting the plan file.
- **PR #864 (KJC-PRP-0002 PR5) — `sharedConflictPolicy` escape hatch**. New config field `hu_board.sharedConflictPolicy: prompt | local-wins | shared-wins` (default `prompt`). When two machines edit the same shared HU, the chosen policy decides without manual intervention. Logged in `~/.karajan/board-conflicts.log`.
- **PR #865 (KJC-PRP-0002 PR6) — per-HU `assignee` field**. Optional free-form handle (`@manufosela`, `dev_016`, `becaria`…) stored on every HU. Surfaced in the board modal **only** for shared projects, editable inline. Backed by an idempotent sqlite migration on `stories.assignee`.

### Tests

5 237 / 5 237 passing in CI across 461 test files (+21 new tests across the 7 PRs, +4 new files).

### Internal

- `EDITABLE_HU_FIELDS` whitelist in `packages/hu-board/src/routes/api.js` now includes `assignee` — PATCH `/api/stories/:id` routes through `setHuFields` → `updateHu` → `writePlan` → `syncPlanFile` end-to-end.
- Frontend caches a per-project `is_shared` flag at `resolveProjectMeta` time, so the "Asignado a" section is conditional without an extra round-trip.

## [2.30.0] - 2026-05-26

Minor release. **Writable config UI on HU Board** — the kj.config.yml is no longer an editor-only file. The board now exposes a settings modal with grouped sections, an atomic-write backend, and a scope toggle between global (`~/.karajan/`) and per-project (`<projectDir>/.karajan/`) configs.

Four PRs land the UI end-to-end (PR1 pipeline toggles, PR2 RAG controls, PR3 grouped modal sections, PR4 scope toggle). Old hand-editing of YAML keeps working — the modal only writes the whitelisted fields and preserves everything else verbatim.

### Added

- **PR #854 (KJC-TSK-0450) — pipeline role toggles in writable config UI**. Eight new boolean fields exposed on the board modal (`pipeline.planner.enabled`, `researcher`, `architect`, `tester`, `security`, `refactorer`, `impeccable`, `brain`). Mirrors the source-of-truth defaults in `src/config/defaults.js`.
- **PR #855 (KJC-TSK-0451) — RAG controls in writable config UI**. Four new fields: `rag.preload.enabled` (boolean), `rag.preload.topK` (1–20), `rag.preload.scope` (all/code/plans/onboarding), `rag.embedder.provider` (ollama/openai/voyage/cohere/mistral/onnx). The provider dropdown matches the six embedders shipped through v2.28.0–v2.29.0.
- **PR #856 (KJC-TSK-0452) — grouped sections in config modal**. Fields are now categorised (Agentes y modelos, Roles del pipeline, RAG, Tiempos de sesión, Calidad) with icons and deterministic order. Backend exports a `CATEGORIES` array so the front renders sections without hard-coding. Unknown categories fall back to "Otros" (defensive — new fields never get dropped from the UI).
- **PR #857 (KJC-TSK-0453) — config scope toggle (global vs per-project)**. New `SCOPES = ['global', 'project']` export. Two-pill toggle in the modal header lets the user switch between `~/.karajan/kj.config.yml` (global, default) and `<projectDir>/.karajan/kj.config.yml` (per-project override). The project file is created on demand on first save. `KJ_PROJECT_DIR || cwd()` resolution matches the journal-parser pattern. Atomic-write + `.bak` discipline applies to both scopes.

### Tests

5 216 / 5 216 passing in CI across 457 test files (+25 new tests across the 4 PRs, +1 new file `tests/board/config-yaml-scope.test.js`).

### Internal

- Single source of truth for editable fields: `packages/hu-board/src/config-yaml.js::EDITABLE_FIELDS` (UI metadata) + `CATEGORIES` (grouping) + `SCOPES` (target file). The front (`packages/hu-board/public/app.js`) iterates the backend metadata — no field is duplicated client-side.

## [2.29.0] - 2026-05-25

Minor release. **RAG quality lift** — retrieval dashboard, three new embedder providers, metadata filtering, cross-encoder rerank.

Five PRs land the next layer of the RAG track. The dashboard is also the first piece of the v2.30 config-UI roadmap (writable settings on the HU Board).

### Added

- **PR #843 (KJC-TSK-0445) — retrieval-quality dashboard on HU Board**. New `/rag.html` page with active embedder, DB size, last-index timestamp, chunks per kind, chunks per project (top 20). Backend `GET /api/rag/stats` reads the local rag.db read-only and embedder config from kj.config.yml. Empty-state when the DB isn't initialized. Linked from main nav.
- **PR #848 (KJC-TSK-0446) — Cohere + Mistral embedder adapters**. `embed-multilingual-v3.0` (1024 dim, strong multilingual) and `mistral-embed` (1024 dim, EU-hosted). KJ_COHERE_KEY / KJ_MISTRAL_KEY scoped env vars. Replaces the "Anthropic via OAuth" roadmap slot — Anthropic has no embeddings endpoint. Shared `_cloud-base.js` keeps the Bearer auth + dim validation single-source.
- **PR #?? (KJC-TSK-0447) — ONNX local embedder via `@huggingface/transformers`**. Sixth provider, fully local: no Docker, no API key, no external service after the first model download. Default `Xenova/all-MiniLM-L6-v2` (384 dim, ~80 MB cached). Higher-quality option `Xenova/jina-embeddings-v2-base-en` (768 dim). The transformers package is an optional peer dep (not auto-installed; helpful error on missing). Unlocks v2.31 zero-config init.
- **PR #?? (KJC-TSK-0448) — metadata `--where` filter for `kj rag query`**. New CLI flag with `KEY=VALUE AND KEY=VALUE` grammar. `kind` filters the column; every other key (symbol, hu_id, headingPath, file, …) goes through SQLite `json_extract` so any metadata the chunker emits is queryable without schema changes. Examples: `--where symbol=loadConfig`, `--where 'hu_id=HU-003 AND kind=plan'`.
- **PR #?? (KJC-TSK-0449) — cross-encoder rerank stage**. Opt-in `--rerank` flag re-scores the topK survivors with a (query, passage) cross-encoder. Default `Xenova/ms-marco-MiniLM-L-6-v2` (~80 MB cached on first use). Runs only on post-fusion candidates so latency is bounded. Plugs in after the kind+source boosts, acting as a finer-grained quality lever.

### Tests

5 757 / 5 757 passing across 396 test files (+87 new tests across the 5 PRs, +7 files).

### Internal

- Embedder factory now wires six providers (ollama / openai / voyage / cohere / mistral / onnx) from a single PROVIDERS table.
- SEA stub registry updated with every new export so the standalone binary keeps printing the friendly "not available" message instead of crashing.

## [2.28.0] - 2026-05-25

Minor release. **RAG advanced** — live re-index + cloud embedders + hybrid scoring + AST chunker.

Five PRs landed plus a real fix for the chapuza shipped in v2.27.0:

- **PR #836 (KJC-TSK-0441) — chokidar watcher**. New `kj watch [start|stop|status]` daemon vigilando `~/.karajan/onboarding/`, `~/.karajan/plans/` y (opt) projectDir sources. Re-indexa el archivo afectado tras 1 s de debounce. `unlink` limpia los chunks. Single-daemon arbitrate via PID file `~/.karajan/watcher.pid`. Resuelve la fricción del manual `kj rag index` tras cada edit.
- **PR #841 (KJC-TSK-0442) — OpenAI + Voyage embedder adapters**. Nuevos `src/rag/embedders/{openai,voyage,_cloud-base,factory}.js`. Desbloquea RAG para usuarios sin Docker local. `config.rag.embedder.provider: ollama | openai | voyage` (default ollama). Env vars Karajan-scoped: `KJ_OPENAI_KEY`, `KJ_VOYAGE_KEY` (preserva architecture invariant — Karajan nunca lee `OPENAI_API_KEY` directamente).
- **PR #838 (KJC-TSK-0443) — BM25 + cosine hybrid scoring**. SQLite FTS5 virtual table `chunks_fts` (contentless + triggers). Nueva función `searchBM25()` + `fuseHits()` que normaliza ambos scores a `[0,1]` y linear-combina via alpha. CLI: `--mode hybrid|semantic|keyword` (default hybrid, alpha=0.6). Hace que queries con símbolos exactos rankeen correctamente.
- **PR #839 (KJC-TSK-0444) — AST source chunker (@babel/parser)**. Reemplaza el regex chunker para JS/TS/JSX. Cada top-level declaration es un chunk; JSDoc + comments leading se foldean. Plugins: typescript, jsx, decorators-legacy, classProperties, topLevelAwait. Fallback a regex chunker si parseo falla.

### Fixed

- **KJC-BUG-0064 (PR #840)** — `parseCooldown` ahora TZ-aware. Cuando el stderr contiene `(Continent/City)`, resuelve el wall-clock target en esa TZ específica via `Intl.DateTimeFormat`. Deshace el workaround skip-in-CI shipped en v2.27.0 (KJC-BUG-0063). Tests pasan en TZ=UTC, Europe/Madrid, Asia/Tokyo, America/Los_Angeles.

## [2.27.0] - 2026-05-25

Minor release. **RAG polish — per-project isolation, unified docs, fairer ranking.**

Three independent improvements triggered by the v2.26.0 smoke test on karajan-code itself, plus a workflow fix surfaced while landing the docs.

### Added

- **Per-project isolation** (KJC-TSK-0438, PR #831). New `project_slug TEXT` column on `chunks` (schema migration is non-breaking — old DBs keep working with NULL). `insertChunk` / `searchSimilar` accept `{ project }`. `indexProject` auto-stamps every chunk with the projectDir basename. `kj rag query` adds `--project <slug>` (defaults to cwd basename; `--project all` disables the filter). Same shape exposed through MCP and the slash command.
- **`docs/RAG.md` + `docs/es/RAG.md`** (KJC-TSK-0439, PR #832). Single unified guide consolidating CHANGELOG entries, role templates and landing pages. Sections: quick start, architecture diagram, installation, six workflows (CLI/MCP/skill/Board/pre-loop/role-instructions), configuration matrix, limitations + roadmap, troubleshooting. README banner links both languages.
- **Asymmetric source-vs-test kind boost** (KJC-TSK-0440, PR #833). The v2.26.0 smoke caught a systematic bias: natural-language queries (`how does X work`) ranked `tests/X.test.js` above `src/X.js` because tests carry more descriptive prose. New rule in `retriever.js`: when the query does NOT mention `test|spec|expect|describe|it|jest|vitest|mocha`, code chunks whose source path is NOT a test file get +0.05 boost. Test-flavoured queries keep the baseline so `vitest mock setup` still surfaces test files.

### Fixed

- **KJC-BUG-0063** (PR #834): `tests/resilience/hibernate-end-to-end.test.js` was time-zone-dependent and broke CI on every PR (passed in `TZ=Europe/Madrid`, failed in CI's `TZ=UTC`). Skipped in CI via `process.env.CI === 'true'` until `parseCooldown` becomes TZ-aware.
- **shrink-budget workflow excludes** (PR #832): `docs/**/*.md` only matched files in subdirectories (`docs/es/RAG.md`) but not `docs/RAG.md` at the root of `docs/`. Mirrored every doc-extension exclude with both `docs/*.ext` and `docs/**/*.ext` patterns. Caught while landing the docs themselves.

## [2.26.0] - 2026-05-24

Minor release. **RAG Auto-Bootstrap** — Ollama runs in Docker out of the box.

Closes the friction caught in the v2.25.0 smoke test: RAG required a manually installed Ollama, which made the feature invisible to new users. From v2.26.0, `kj init` provisions Ollama in Docker, pulls `nomic-embed-text`, and wires the embedder into the config — same opt-out shape as SonarQube.

### Added

- **Ollama-in-Docker manager** (KJC-TSK-0435, PR #825). `src/rag/ollama-manager.js` mirrors `src/sonar/manager.js`: `normalizeOllamaConfig`, `buildComposeTemplate`, `ensureComposeFile`, `isOllamaReachable`, `waitForOllamaReady`, `findAvailableOllamaPort`, `ollamaUp` / `ollamaDown`. `ollamaUp` short-circuits when the host is already reachable (returns `reusedHost`) and refuses when `external=true` and unreachable.
- **Capability check + auto-pull + `kj init` bootstrap** (KJC-TSK-0436, PR #828). `src/rag/ollama-capability.js` checks Docker availability + free RAM (>= 4 GB default). `kj init` runs `bootstrapOllama()` after installing skills: skip on `--no-ollama`, skip with warning on capability fail, otherwise `ollamaUp()` + `waitForOllamaReady()` + `pullOllamaModel('nomic-embed-text')`.
- **`kj doctor` Ollama check + `kj ollama` subcommand** (KJC-TSK-0437, PR #827). New `src/checks/ollama.js` and `src/commands/ollama.js`. `kj ollama [start|stop|status|pull <model>]` lets the user manage the container without touching docker compose.

### CLI flags

`kj init --no-ollama` — skip the RAG embedder bootstrap.

### Behaviour matrix

| Scenario | What happens |
|---|---|
| `kj init` on Linux with Docker + 8 GB free | Container starts, model pulls, RAG ready |
| `kj init` on Windows without Docker | Warn `docker:not-installed`, init continues |
| `kj init --no-ollama` | Skip with one-line log |
| Host with Ollama on :11434 already | Reuses external instance |
| `kj doctor`, `rag.preload.enabled=true`, container down | `warn` + fix hint `kj ollama start` |

### Bug fix bundled

- **KJC-BUG-0061** (PR #824): smoke test of v2.25.0 caught two latent bugs in `kj onboard` and a CLI/MCP empty-store contract mismatch. Fixed and shipped between v2.25.0 and v2.26.0.

## [2.25.0] - 2026-05-24

Minor release. **RAG Camino B + Camino D** (KJC-PCS-0049). Closes the consumer-surface plan: Skills hosts can now invoke RAG without MCP, and the pre-loop retrieval stage only fires when triage signals make it worthwhile.

### Added

- **`/kj-rag-query` slash command** (KJC-TSK-0433, PR #821). New `templates/skills/kj-rag-query.md` template. `kj init` ships it to `.claude/commands/` so hosts that load Karajan via Skills (Claude Code without MCP, Cursor without MCP) can reach the RAG retriever through `/kj-rag-query <text> [--scope <s>] [--top-k <n>]`. Thin wrapper over the existing `kj rag query` CLI: passthrough flags, empty-store hint without blocking the conversation, render chunks as background context (not raw JSON).
- **Brain decisor heuristic for pre-loop retrieval** (KJC-TSK-0434, PR #822). New module `src/orchestrator/stages/rag-preload-decisor.js`. Pure function `shouldPreloadRag({triage, task, config}) → {pull, reason}`. Wired in `pre-loop.js` before `runRagContextStage`. Policy `config.rag.preload.policy`: `always` (back-compat with v2.24.0), `never` (benchmarking), `auto` (default). In auto mode, pulls when triage decomposes, level is complex/high/epic, task body ≥ 200 chars, or `config.rag.preload.brownfield` is set. Otherwise persists `ragPreload: { skipped: true, reason: 'auto:low-value' }` so resume + audit see why retrieval was skipped.

### Toggle

`config.rag.preload.enabled` still defaults to `false` (opt-in). `config.rag.preload.policy` defaults to `auto`. Existing v2.24.0 setups behave unchanged unless they explicitly set `policy=auto`.

### Out of scope (v2.26.0+)

chokidar watcher (live re-indexing), AST source chunker (tree-sitter or `@babel/parser`), BM25 + cosine hybrid scoring.

## [2.24.0] - 2026-05-24

Minor release. **RAG Camino C — pre-loop auto-retrieval** (KJC-PCS-0049). After v2.23.0 taught the agents that `kj_rag_query` exists, Karajan now injects prior context for them automatically.

### Added

- **`runRagContextStage` pre-loop stage** (KJC-TSK-0432, PR #819). New module `src/orchestrator/stages/rag-context-stage.js`. Runs between triage and domainCurator. Five guards before retrieval fires: `disabled`, `no-task`, empty corpus, no hits, error. All five degrade silently except `empty` (info log pointing at `kj rag index`). The stage never throws. When all guards pass, mutates the `task` parameter prepending `## Prior context from RAG` block with top-K chunks. One mutation feeds researcher/architect/planner/coder via the existing parameter chain.

### Toggle

`config.rag.preload.enabled = false` by default (opt-in). `config.rag.preload.topK` (5) + `config.rag.preload.scope` (`all`).

### Compatibility with Camino A (v2.23.0)

Role templates from PR #817 already tell agents that `kj_rag_query` exists for on-demand queries. Camino C complements: agent gets context automatically at start; agent can still call the tool for follow-ups.

### Out of scope (v2.25.0+)

Camino B (Skills slash command), Camino D (Brain decisor for when to pre-fetch), chokidar watcher, AST source chunker, BM25 hybrid scoring.

### Workflow

```bash
kj onboard
kj rag index
yq -i '.rag.preload.enabled = true' ~/.karajan/kj.config.yml
kj run task.md  # researcher/architect/planner/coder see prior context automatically
```

## [2.23.0] - 2026-05-24

Minor release. **RAG exposed to agents and humans alike**: closes Steps 7 + 8 + Camino A of the Project RAG epic (KJC-PCS-0049).

### Added

- **`kj_rag_query` + `kj_rag_index` MCP tools** (KJC-TSK-0429, PR #815). Tool count 25 → 27. Empty store responds `empty: true`.
- **HU Board RAG search panel + `/api/rag/query` endpoint** (KJC-TSK-0430, PR #816). Input + scope dropdown + Search button + results pane between preflight and kanban.
- **Role templates teach agents about the tool** (KJC-TSK-0431, PR #817). `templates/roles/{coder,researcher,architect,planner,spec-reviewer}.md` gain tailored 'Prior context (RAG, opt-in)' sections.

### Workflow

```bash
kj onboard                              # one-time per project
kj rag index                            # one-time per project
kj plan generate task.md --use-onboarding
# Agents call kj_rag_query via MCP, humans use the Board panel.
```

### Out of scope (v2.24.0+)

Camino B (slash command for Skills hosts), Camino C (pre-loop stage with automatic retrieval), Camino D (Brain decisor for when to retrieve), chokidar watcher, AST source chunker, BM25 hybrid scoring.

## [2.22.0] - 2026-05-24

Minor release. **Project RAG epic (KJC-PCS-0049) MVP** ships in six PRs: Karajan now indexes plans + onboarding briefs (and optionally project sources) into a local vector store and lets you query them semantically from the CLI.

### Added

- **`kj rag` command group** (KJC-TSK-0428, PR #813). Two subcommands:
  - `kj rag index [--with-sources] [--json]` — runs `indexer.indexProject()` on the current project: every `~/.karajan/plans/<slug>/plan-*.json` + `~/.karajan/onboarding/<slug>.md` is chunked, embedded and persisted. With `--with-sources` also walks `.js/.ts/.tsx/.jsx` (skipping `node_modules`, `.git`, `dist`).
  - `kj rag query <text> [--scope plans|code|onboarding|all] [--top-k N] [--json]` — embeds the query, fetches top-K nearest, reranks by kind (plan +0.05, onboarding +0.03, code 0), prints each hit with its most-specific label.
- **Vector store on better-sqlite3 + sqlite-vec** (KJC-TSK-0423, PR #808). `~/.karajan/rag.db` (override via `KJ_RAG_DB`). New dep `sqlite-vec ^0.1.9`.
- **Ollama embedder adapter** (KJC-TSK-0424, PR #809). `OllamaEmbedder.embed/embedBatch` against the local Ollama endpoint. Defaults `localhost:11434` + `nomic-embed-text` + dim 768. Zero new deps.
- **Three chunkers** (KJC-TSK-0425, PR #810). `chunkMarkdown` (heading hierarchy), `chunkPlan` (one chunk per HU), `chunkSource` (JS/TS export-symbol via regex). Shared windowed splitter for oversized sections.
- **Indexer** (KJC-TSK-0426, PR #811). `indexFile` + `indexProject`. Idempotent — calls `deleteChunksBySource` before re-indexing. Embedder failures = `warn` + continue.
- **Retriever** (KJC-TSK-0427, PR #812). `query(db, embedder, text, { topK, scope, kindBoost })` — over-fetches `topK*2`, applies kind boosts, returns ranked hits with metadata.

### SEA binary

`src/rag/*` + `src/commands/rag.js` join `packages/hu-board/src/*` in the list of modules the SEA bundle stubs out (`scripts/esbuild-sea.config.mjs::ragStubPlugin`). The standalone binary points users at `npm install -g karajan-code` for RAG.

### End-to-end workflow

```bash
cd ~/your-project
kj onboard                       # Architecture Brief at ~/.karajan/onboarding/<slug>.md
kj plan generate task.md -y      # Plans at ~/.karajan/plans/<slug>/plan-*.json
kj rag index                     # Seed the vec store
kj rag query "how did I handle auth in module X?"
```

### Out of scope (v2.23.0+)

MCP tool `kj_rag_query`, HU Board search panel, chokidar watcher for live re-indexing, AST-aware source chunker, BM25 + cosine hybrid scoring.

## [2.21.0] - 2026-05-24

Minor release. **Brownfield Onboarder role**: Karajan now ships a dedicated path to bootstrap an Architecture Brief from any existing codebase, and the planner can consume that brief as automatic context. Closes KJC-TSK-0384 in three PRs.

### Added

- **New `kj onboard` command + OnboarderRole** (KJC-TSK-0384, PRs #804 + #805). Runs five deterministic collectors over a project root — `collectTree` (directory walk ignoring `node_modules` / `.git` / `dist` / `build` / etc.), `collectGitHistory` (commits, branches, hot files via `--name-only` over the last 200 commits), `collectConfigs` (presence of 18 well-known config patterns + package.json scripts), `collectAdrs` (ADR-style filenames under `docs/adr/`, `docs/adrs/`, `docs/architecture/`), and `collectAll` as the one-shot bundle — and then optionally synthesises a Markdown Architecture Brief via the OnboarderRole. Output lands at `~/.karajan/onboarding/<slug>.md`. Flags: `--no-synth` (skip the LLM call and dump the raw collectors bundle, useful for CI / token-cost-sensitive contexts) and `--output <path>` (override default target). Greenfield projects produce `# Project is greenfield` instead of erroring. The collectors are stack-aware via `detectProjectStack`; adding a stack to the brief is one branch in `composePreflightTests`-style code.
- **New `--use-onboarding` flag on `kj plan generate`** (PR #806). When set, reads the cached Architecture Brief via `readCachedBrief(projectDir)` and prepends it to the planner's context under a `## Architecture Brief (from kj onboard)` heading. Silent on cache miss without the flag; loud `warn` when the flag is set but no cache exists, so a missed `kj onboard` invocation surfaces immediately. The brief flows into the planner alongside any explicit `--context` the user passes; both compose.

### Workflow

```bash
kj onboard                            # produces ~/.karajan/onboarding/<slug>.md
kj plan generate task.md \
    --use-onboarding                  # next plan reads the brief as context
```

### Out of scope

- The Project RAG epic (KJC-PCS-0049) starts in v2.22.0 — vector store, Ollama embedder, indexer, retriever, CLI / MCP / HU Board consumers. Onboarder is the prerequisite (its `onboarding_context.json` feeds the indexer), so closing it cleanly here unblocks the next minor.

### Tests

5 387+ tests / 458+ test files passing on Node 20 and Node 22 CI.

## [2.20.0] - 2026-05-24

Minor release. **HU Board polish + UX papercuts** cluster: 5 cards closed (2 net-new features, 2 housekeeping PG syncs for work that had already landed quietly, 1 doc refresh).

### Added

- **`kj plan generate` now prepends a `[PREFLIGHT-000]` HU to every plan** and gates all functional HUs on it via `blocked_by` (KJC-TSK-0397, PR #801). The HU's acceptance tests are stack-aware shell commands — `git status --porcelain`, `node --version` + `npm install` + conditional `npm test`/`npm run lint` for Node, `python --version` + `pip install -r requirements.txt` (or `poetry install`) + `pytest --collect-only` for Python, plus `firebase projects:list` when `firebase.json` exists and `gcloud auth list` when `.gcloudignore` exists. Idempotent: a plan that already has a HU titled `PREFLIGHT-000` / "verificar entorno" is left untouched. Opt out per-invocation with `--no-preflight-hu`. New module `src/plan/preflight-hu.js` (102 LOC) + 6 acceptance tests.
- **`kj init` learns a config scope wizard plus `--global` / `--local` flags** (KJC-TSK-0395, PR #802). In an interactive TTY without flags, the wizard now asks whether the config should land at `~/.karajan/kj.config.yml` (global, applies to all projects) or `./.karajan/kj.config.yml` (local override, project-scoped). `--global` and `--local` skip the prompt for CI scripts; passing both throws `Cannot pass both --global and --local`. Non-interactive without flags stays on global for legacy CI compatibility. `loadConfig` (src/config/loader.js) now refuses to load a project that has a local config without a global counterpart — the override-only-on-top-of-base invariant — with an actionable message pointing at `kj init --global` to create the base. New exported function `resolveConfigScope({ flags, interactive })` for unit testing without spinning up the rest of `initCommand`.

### Synced to PG

These were already implemented in main but their cards were stuck in "To Do" until today's PG housekeeping pass:

- **HU Board `⏹ Stop` button** (KJC-TSK-0396, originally PRs #702 + #703): aborts every `kj run` associated with a plan via SIGTERM → SIGKILL escalation (5 s timeout), resets running HUs to pending, available only when at least one HU is in `coding`/`reviewing`. Frontend delegate handler + backend `POST /api/runs/:planId/stop` + persistent run-tracker registry for terminal↔board bidirectionality.
- **HU Board auto-cleanup ampliado** (KJC-TSK-0377, originally PR #683): the ephemeral-project sweep now also catches `s_*`, `plan-*`, `auto-tmp_*`, `auto-test_*` prefixes alongside the original `tmp_*` / `test_*` / `demo_*` / `kj-test-*` set. Projects with `is_test=2` (📌 keep) stay exempt. Home-style `home_<path>` projects with real git repos are never swept.

### Docs

- `docs/task-templates/spec-conventions.md` adds two sections (KJC-TSK-0385, PR #800): **Section 8** documents that numbered headings (`## 1.`, `### 2.1`, `§5`) activate the `spec_section` REQUIRED field on every step. **Section 9** documents the `acceptance_tests` shape: 2-4 tests per step, mix of `gherkin` and `shell`, pre-implementation, never the placeholder `npx vitest run`. The top quick-reference table + the pre-generate checklist were updated to reference both. Plus `docs/task-templates/plan-generate.md` switches its two stale `~/.kj/plans/` example paths to `~/.karajan/plans/` (post-v2.19.0 home consolidation).

## [2.19.4] - 2026-05-24

Patch release. `kj resume` continúa donde paró y `autoInit` ya no produce commits zombie en el repo del usuario.

### Fixed

- **`kj resume` re-arrancaba researcher + architect en lugar de continuar desde el último checkpoint** (KJC-BUG-0058, PR #798). Reportado por Aitor Martínez con screenshot: una sesión que paró durante Sonar, al hacer `kj resume <id>`, re-ejecutaba todo el pre-loop pipeline (HU-reviewer → intent → discover → triage → domainCurator → researcher → architect → planner) desde cero — doblando coste de tokens y rompiendo el value-prop del comando. Causa raíz: `resumeFlow` (flow-runner.js:280) cargaba la sesión y llamaba `runFlow` sin propagar nada sobre qué stages estaban hechas; `runFlow` → `initFlowContext` arrancaba con `ctx.stageResults = {}` siempre. La sesión NUNCA persistía los outputs de stage en `session.json`. **Fix**: dos nuevos mutators en `src/session/mutators.js` — `setStageResult(session, name, result)` mantiene `stage_results[name]` + `stages_completed[]` (idempotente), y `setStageBundle(session, name, bundle)` añade `stage_bundles[name]` para cross-stage context que el stageResult no carga (researcher → `researchContext`, architect → `architectContext`, planner → `plannedTask`). Dos closures en `runPreLoopStages` (`persistStage` + `resumeSkip`) envuelven cada stage cacheable. `init-context.js` rehydrata `ctx.stageResults` desde `session.stage_results` antes de `runPreLoopStages` — sin nuevo flag por la cadena. Triage NO se skipea (emite `roleOverrides` que el Brain decisor necesita; es cheap). 10 test files / 57 tests de orchestrator siguen verdes.
- **`autoInit()` commiteaba vacío en el main del usuario al dogfooding kj sobre el propio repo** (KJC-BUG-0060, PR #797). Reportado por mjfosela durante el release de v2.19.3: tras `git checkout main`, `git status` reportaba `[adelante 27]` ante origin/main. Los 27 commits — titulados `initial commit`, autor `@manufosela` (el git config local de karajan-code usaba un email distinto del email global del usuario), tree idéntico a su parent = **commits completamente vacíos**. El reflog acumulaba **2 495 SHAs** con el mismo patrón desde abril 2026. Ninguno había llegado nunca a origin/main (gh push / CI los habrían rechazado), pero ensuciaban main local y en cada release parecía pérdida de sync. Causa raíz: `src/orchestrator/config-init.js::autoInit()` guardaba con `!(await exists(projectDir/.git))`, demasiado débil. Dos modos de fallo combinados: (1) dogfooding kj sobre karajan-code (kj-linked) desde un subdir del repo → `exists()` devolvía false → `git init` reinicializaba el `.git/` del padre (idempotente) → `git commit --allow-empty` resolvía hacia arriba y aterrizaba commit vacío en main; (2) race FS transitoria con `exists()` falso-negativo. **Fix**: cambio el FS probe estático por `git rev-parse --is-inside-work-tree`, que hace la misma upward-traversal que git haría para el commit — el guard no puede discrepar con la operación que custodia. Drop del `git commit --allow-empty -m "initial commit"` que seguía al `git init` — ningún stage downstream necesita root commit; los 2 495 commits nunca rompieron nada, el seed era decorativo y era el síntoma user-visible. 3 acceptance tests en `tests/orchestrator/config-init-autoinit.test.js`.

## [2.19.3] - 2026-05-23

Patch release. HU Board now reads + writes plans from the canonical home dir.

### Fixed

- **HU Board reported "Directorio del proyecto — no detectado" even when the run had a valid `projectDir`** (KJC-BUG-0059, PR #795). Five board call sites still hard-coded `~/.kj/plans/` as their plans root — leftover from the v2.19.0 home consolidation, which fixed `sync.js` but missed the rest. After the auto-migrator runs, plans land under `~/.karajan/plans/<slug>/`; the board kept looking under `~/.kj/plans/<slug>/` and silently found nothing. That meant: `GET /api/projects/:id/preflight` could not extract `projectDir` (the literal Aitor saw), `GET /api/projects/:id/plans-outcome` returned `plans: []` for every project, `DELETE /api/projects/:id` swept the wrong path leaving residue on disk, `DELETE /api/plans/:planId` failed silently, `preflight.checkPlans` reported "plans missing" wrongly, `plan-mutations.plansRoot` wrote new per-HU run logs to the legacy root splitting state across both, and `cleanup-zombies` never GC'd zombies under `~/.karajan/plans/`. **Fix**: three new exports in `packages/hu-board/src/db.js` — `getHuBoardPlansDir()` (canonical, or `KJ_PLANS_DIR` override), `getHuBoardLegacyPlansDir()` (legacy, null when override set), `getHuBoardPlansDirs()` ordered `[canonical, legacy?]` for read callers. Single-write callers (`plan-mutations`) use the canonical root; read / delete / GC iterate both so users mid-migration with plans still under `~/.kj/` don't regress. 29 hu-board test files / 349 tests still green. Reported by Aitor Martínez.

## [2.19.2] - 2026-05-23

Patch release. SonarQube auto-recovery from 401.

### Fixed

- **Sonar 401 now triggers automatic token re-bootstrap instead of failing the run** (KJC-BUG-0057, PR #793). Until v2.19.1, when the configured Sonar token was missing / stale / revoked / pointing at a recreated Sonar instance, `kj run` / `kj audit` threw `SonarQube authentication failed (HTTP 401)` with the hint "Regenerate with `kj init`" — putting the user in the loop for plumbing that Karajan can do itself. **Fix**: `src/sonar/api.js::sonarFetchOnce` now invokes the new `src/sonar/token-recovery.js::recoverSonarToken()` on the first 401 of a process. Recovery reuses `bootstrapSonarToken()` (already shipped in v2.10.2) — it probes admin/admin against the Sonar host, rotates the default password if still in place, revokes the existing `karajan-cli` token, generates a fresh `GLOBAL_ANALYSIS_TOKEN`, mutates `config.sonarqube.token` in place AND mirrors the new token to `~/.karajan/sonar-credentials.json` so future processes pick it up via the normal resolver chain instead of triggering recovery again. The original request retries once with the new token; the user never sees the 401 when recovery succeeds. Per-process latch ensures one Sonar run that 401s on N endpoints triggers ONE bootstrap, not N. If recovery itself fails (e.g. admin password was customised manually), the user gets a more actionable error — pointing at `~/.karajan/sonar-credentials.json` for saving admin user/password — instead of a generic "kj init" hint. Programmatic, zero LLM involvement. Reported by Aitor Martínez.

## [2.19.1] - 2026-05-23

Patch release. **APPLICATION BLOCKER** fix for the HU Board.

### Fixed

- **`kj board start` failed with `ERR_MODULE_NOT_FOUND` on every fresh `npm install -g karajan-code`** (KJC-BUG-0056, PR #791). Two independent bugs combined to break the documented HU Board feature for every user installing from npm: (1) the root `package.json::files` array did not include `packages/`, so `npm pack` was shipping a tarball with no HU Board code at all — confirmed via `npm pack --dry-run`. (2) Even after copying `packages/hu-board/` manually (the fallback some users tried), the board crashed at startup with `Cannot find package 'helmet' imported from .../packages/hu-board/src/server.js` because the five HU Board dependencies (`helmet`, `chokidar`, `better-sqlite3`, `express`, `express-rate-limit`) were declared in `packages/hu-board/package.json` but NOT in the root `dependencies`, so `npm install -g karajan-code` never pulled them. **Fix**: add `packages/hu-board/{src,public,package.json}` to `files`; add the five HU Board deps to root `dependencies` at the exact versions the sub-package declares (so `npm dedupe` collapses to one copy resolvable by upward traversal from `server.js`); regenerate `package-lock.json`. Verified end-to-end: `npm pack --dry-run` now ships 12 board files; `node packages/hu-board/src/server.js` boots cleanly. Reported by Aitor Martínez.

### Internal

- **38 direct `os.homedir()` callers routed through the unified resolver** (KJC-TSK-0420, PR #790). `KARAJAN_HOME=/some/path kj <anything>` now redirects EVERY component to `/some/path/…` — not just plans / standby / sessions, but also the webperf cache, run-registry, board prompt bridge, HU Board auth token, the `hu-board.pid` file, the `kj.config.yml` read by the board's config viewer, and the `kj doctor` dir-setup check. Three new helpers in `src/utils/paths.js` (`getWebperfDir`, `getRunsDir`, `getPromptsDir`) and a `KARAJAN_HOME` priority added to `packages/hu-board/src/db.js::getKjHome`. The legitimate non-Karajan callers (`os.homedir()` for `~/.claude.json`, `~/.codex/config.toml`, npm-global bin lookups, the fs-leak detector) stay untouched.
- **5 inline constructions of `~/.karajan/hu-board-runs/` unified under `getHuBoardRunsDir()`** (KJC-TSK-0421, PR #789). Pure DRY refactor; no behaviour change.

## [2.19.0] - 2026-05-23

Minor release. Closes [KJC-PCS-0047](https://planning-game.web.app) — the **home-directory consolidation** epic. Three back-to-back PRs (#781, #782, #783) unify the HOME-level state of Karajan into a single `~/.karajan/` root, with a one-shot auto-migrator that moves legacy `~/.kj/` content on the next `kj` invocation (idempotent, tarball-backed). and audits the user's spec for deficiencies that would otherwise cause the pipeline to spend tokens on the wrong work (KJC-PCS-0048, PRs #785 + #786 + #787 + #788). The role classifies findings across seven categories — `ambiguity`, `missing_scope`, `missing_ac`, `contradiction`, `stack`, `assumptions`, `out_of_scope` — with per-finding severity (`info` / `warn` / `fail`) and a top-level severity that is the worst of any finding (`ok` if none). On a clean spec the run prints a single `✓ spec OK` line and continues; on findings the user gets a coloured, category-grouped block on stderr plus an interactive `[c]ontinue / [r]efine / [x]cancel` prompt. **Refine** asks the role for a rewritten v2 of the spec, persists both versions to `<projectDir>/.reviews/spec-review-<ISO>/spec-v1.md` + `spec-v2.md` (and mirrors v2 next to `--task-file` if supplied), opens `$EDITOR` on v2, and uses a SHA-256 hash diff to decide whether to re-review (user modified v2) or proceed with v2 as the effective spec (user accepted untouched). Capped at 5 refine iterations. Defaults to **on**; bypass per-invocation with `--skip-spec-review` on the CLI or `specReviewMode: "skip"` on the MCP tools `kj_run` and `kj_plan`. Provider configurable via `roles.spec_reviewer.provider` / `roles.spec_reviewer.model` in `kj.config.yml` (inherits from `coder` by default). Trust-the-worse semantic guards against agents that under-report severity. Degrades to a single soft warning on a non-JSON LLM output instead of throwing. Safe upgrade from 2.19.x.

## [2.19.0] - 2026-05-23

Minor release. Closes [KJC-PCS-0047](https://planning-game.web.app) — the **home-directory consolidation** epic. Three back-to-back PRs (#781, #782, #783) unify the HOME-level state of Karajan into a single `~/.karajan/` root, with a one-shot auto-migrator that moves legacy `~/.kj/` content on the next `kj` invocation (idempotent, tarball-backed).

4 984/4 984 tests passing across 418 test files.

Safe upgrade from 2.18.x.

> ⚠️ **Note**: v2.19.0 shipped with a packaging bug that broke `kj board start` for fresh installs. Use **v2.19.1 or later**.

### Changed

- **`~/.kj/` consolidated into `~/.karajan/`** (KJC-PCS-0047, PRs #781 + #782 + #783). Plans, hibernated standby state, run-registry entries and worktrees previously lived under `~/.kj/`; everything else lived under `~/.karajan/`. There was no ADR justifying the split, four divergent `getKjHome()` implementations had drifted, and new users could not find their plans. The HOME-level state is now unified under `~/.karajan/`. **The legacy `~/.kj/` directory is auto-migrated on the next `kj` invocation** (one-time, idempotent via `~/.karajan/.kj-migrated.json`). A tarball backup of the pre-migration tree lands at `~/.karajan/backup/kj-pre-migration-<ISO>.tar.gz` BEFORE anything moves — restore is one `tar -xzf` away. `plans/`, `standby/` and `worktrees/` are moved wholesale; `runs/` is merged with the canonical `~/.karajan/runs/` winning on file-name collision. The HU Board's plan watcher reads both the canonical and legacy locations until the next `kj` command triggers the migrator, so users who start the board first never see "missing plans".
- **`KARAJAN_HOME` is the new canonical env var** for overriding the HOME-level Karajan root. `KJ_HOME` keeps working but emits a one-shot per-process `[warn] KJ_HOME is deprecated, rename to KARAJAN_HOME` the first time it is consulted. Precedence: `KARAJAN_HOME` > `KJ_HOME` (with warning) > VITEST tmp > `~/.karajan`.
- **`kj doctor` reports unmigrated legacy `~/.kj/`** as a `warn`-severity check (`legacy-kj-home`) with the fix line `Run any kj command (e.g. kj doctor) — the migrator runs automatically`.

## [2.18.1] - 2026-05-23

Patch release. Six follow-ups to v2.18.0, all triggered by direct user feedback after the public launch.

4 971/4 971 tests passing across 416 test files.

### Fixed

- **`kj-tail` was silent after `kj resume`** (#772). `kj-tail` follows a fixed `<cwd>/.kj/run.log`; every CLI command opens that file via `withCliRunLog()` — except `kj resume`, which built its emitter by hand and skipped the wrapper. Resume now uses the same shape as `run.js` (`withCliRunLog` + `registerRun` + signal cleanup), so the resumed run writes `.kj/run.log` and the HU Board sees it as live.
- **Standby waits in-process instead of exiting on a short cooldown** (#773). Previously every quota hibernation returned `action:"hibernate"` and the caller exited — so even a 4-hour wait forced the user to come back and run `kj standby resume` manually. Now `withBrainRecovery` always persists the standby first; if `retryAfter <= standbyWaitHoursMax` (default 12 h) it sleeps in-process and retries; SIGINT / SIGTERM during the wait prints `kj standby resume <id>` and exits cleanly. Longer waits (weekly / monthly caps) still exit, same as before.
- **Closed KJC-BUG-0040 — binarios SEA fallaban desde v2.12.0** (#774). Not `esbuild + better-sqlite3` (that was fixed in v2.13). The real cause was a **race condition** between `gh release create` (release checklist step) and `softprops/action-gh-release@v2` (workflow): linux-x64 — always the fastest job — reached the upload step before GitHub indexed the release-by-tag, softprops created a duplicate draft, and the final `PATCH draft:false` failed with `422 already_exists`. Added a 60 s defensive poll for the release to be discoverable before invoking softprops, plus `make_latest:false` + `append_body:false` so the action can never mutate the human-created release. There are 4 orphan drafts in the repo (v2.7.4 / v2.10.0 / v2.11.0 / v2.18.0) — delete them with `gh release delete <tag>` after upgrading.
- **Stack bias — Python repos received vitest** (#775 + #776 + #777). Karajan had multi-language stack detectors but never wired them to the coder, the auto-generator, the synthesizer or `auto-hu-batch`. So a pure-Python project got `npm install` + `npx vitest run` as acceptance_tests and the coder installed vitest to satisfy the contract. Three PRs fix the canal:
  - **#775 (coder)** — `CoderRole.buildPrompt()` calls `detectProjectStack` + `detectTestFramework` and passes them to `buildCoderPrompt`, which emits a `## Project Stack` section. Relaxed three JS-only lines (httpOnly cookies, `console.log`/JSDoc, `npm install`).
  - **#776 (auto-generator)** — HU templates per language (`python` / `go` / `rust` / `javascript`); `filterConflictingHints` is now symmetric (Python wins over stale vitest hints).
  - **#777 (synthesizer + auto-hu-batch)** — `auto-hu-batch` calls `detectProjectStack` on the filesystem (overrides any text-based guess); `buildSynthesizerPrompt` accepts `stack`/`testFramework` so the LLM emits `pytest` / `go test` / `cargo test` shell commands instead of falling back to vitest.

## [2.18.0] - 2026-05-23

Minor release. Closes the **resilience audit** triggered by the public launch: 15 PRs across 5 phases hardening Karajan against the silent-failure family of bugs — *"the problem is not that something fails, the problem is failing without telling the user why."* A quota cap now hibernates and tells the user how to resume; subprocesses surface their errors; state writes are crash-safe; the orchestrator's decision layer no longer degrades silently.

4 959/4 959 tests passing across 416 test files.

### Added

- **Resilience suite** `tests/resilience/` (#770) — index of every silent-failure mode caught by the audit and the test that pins each one, plus an end-to-end tripwire walking the whole quota → hibernate → resume flow.

### Fixed — Phase 1: Quota hibernation end to end

- **Session-limit classification** (#756) — `"You've hit your session limit · resets 10:10pm"` matched no rate-limit pattern and reached `UNKNOWN_FATAL`. `session limit` / `weekly limit` added; `parseCooldown` learns the 12-hour `resets 10:10pm` clock.
- **Standby persistence** (#757) — `withBrainRecovery` only persisted with a `sessionState`, but no caller passed one. New `buildStandbyState()` builds it with an allowlisted env subset (never the full `process.env`).
- **Orchestrator consumes `action:"hibernate"`** (#758) — no code path checked for it, so a hibernation was indistinguishable from a generic failure. The coder / refactorer stages now stop cleanly on a quota cap; the session is sealed `hibernated` (resumable), not `failed`.
- **Resume hint** (#759) — a stopped `kj run` / `kj plan`'s last line is now the exact command (`kj standby resume <id>` for hibernation, `kj resume <id>` otherwise). `kj plan` no longer turns a quota cap into a thrown error.

### Fixed — Phase 2: Don't lie

- **`runCommand` ENOENT propagation** (#761) — execa with `reject:false` resolved on spawn failure with an empty stderr; a missing agent CLI failed `kj run` with no message. `enrichResult` now surfaces `shortMessage` / `code` and exposes `spawnError`.
- **Hung-agent silence timeout** (#762) — `AgentRole.execute()` never forwarded `silenceTimeoutMs`, so a stalled coder (network wedged, prompt waiting on auth) hung `kj run` forever. Every role now propagates it from `config.session.max_agent_silence_minutes`.
- **Atomic state writes** (#763) — every persistent state file (plans, sessions, standby, run registry, board mutations) was overwritten in place. New `writeJsonAtomic{,Sync}` (write-temp + rename) protects six call sites from torn writes on crash / SIGKILL / power loss.

### Fixed — Phase 3: Don't lose or block

- **Corrupt plan JSON surfaced** (#764) — a truncated plan file used to vanish silently from `kj plan list` / `kj plan load`. Now warns with the file path and renames it aside to `<name>.corrupt-<ts>`.
- **Actionable YAML error** (#765) — a bad edit in `kj.config.yml` bricked every kj command (including `kj doctor`) with a `YAMLException` that didn't name the file. All three readers now throw `Invalid YAML in <path>: <detail>` with `code: "INVALID_YAML"`.
- **HU zombie reconciler** (#766) — a killed `kj run --plan` left HUs in `coding` / `reviewing` / `running` in the plan JSON forever (the board-side reaper only runs inside the board). `injectLoadedPlan` now resets them to `pending` at load time, cross-checking `run-registry` so a live run owning the plan is not touched.
- **Board SQLite hardening** (#767) — `busy_timeout = 5000` (no more `SQLITE_BUSY` crashes), `PRAGMA user_version` (refuses to open a DB written by a newer Karajan with renamed columns), and corruption recovery (moves a malformed DB aside and rebuilds the cache from disk).

### Fixed — Phase 4: Don't degrade silently

- **Triage no silent fallback** (#768) — `TriageRole` used to return `ok:true` with `"Triage complete (fallback defaults)"` on an unparseable LLM output, silently skipping researcher / architect / security / tester for a complex task. Now warns loudly via `logger.warn`.
- **Verification-gate distinguishes git failure** (#769) — `countChangesSince` / `countUntrackedFiles` caught git errors and returned zeros, so a bad `baseRef` / corrupt repo / missing git was indistinguishable from "the coder did nothing". `verifyCoderOutput` now bails out on `gitError` with `retryStrategy: null` — no more wasted iterations blaming the agent for infra.

### Internal

- CI now exercises the `packages/hu-board` test suite on every PR (#755).

## [2.17.2] - 2026-05-22

Patch release. Wires quota-exhaustion **hibernation end to end**: a `kj run` / `kj plan` that hits a provider session or usage cap now suspends, persists its state, and tells you how to resume it — instead of failing the task with an opaque `UNKNOWN_FATAL`.

4 931/4 931 tests passing across 410 test files.

### Fixed

- **Claude Code session-limit classification** (#756). `"You've hit your session limit · resets 10:10pm"` matched no rate-limit pattern → `UNKNOWN_FATAL` → abort. `session limit` / `weekly limit` are now recognised, and `parseCooldown` learns the 12-hour `resets 10:10pm` clock so the Brain knows when the quota resets.
- **Hibernation is now persisted** (#757). `withBrainRecovery` only writes `~/.kj/standby/<id>.json` when given a `sessionState`, but `agent-role.js` and `plan/generate.js` never passed one — so a hibernating run had nothing to resume from. New `buildStandbyState()` assembles it, carrying an allowlisted env subset (`KJ_*`, `HOME`, `PATH`) instead of the full `process.env`.
- **The orchestrator now consumes `action:"hibernate"`** (#758). No code path checked for it, so a hibernation was treated as a generic failure and the HU was sealed `failed`. The coder and refactorer stages now stop cleanly on a quota cap (no fallback, no Solomon); the session is sealed `hibernated` (resumable), not `failed`.
- **Stopped runs tell you how to resume** (#759). New `printResumeHint()` prints, as the last line of a halted `kj run` / `kj plan`, the exact command — `kj standby resume <id>` for a hibernation, `kj resume <id>` for any other stop. `kj plan` no longer turns a quota cap into a thrown error.

### Internal

- CI now runs the `packages/hu-board` test suite (~344 tests) on every PR — it was previously never exercised in CI (#755).

## [2.17.1] - 2026-05-22

Patch release bundling two HU Board fixes. **KJC-BUG-0055**: a deleted project no longer resurrects when running `kj plan` or restarting the board. **Silent board-start failure**: `kj board start` no longer fails without leaving a trace in the log.

4 909/4 909 tests passing across 408 test files.

### Fixed

- **KJC-BUG-0055 — HU Board resurrection** (#751). A project deleted from the board (🗑️ button) reappeared on the next `kj plan` or board restart. Four independent leaks closed:
  1. **`sync.js` — temporal gate**: the unconditional `removeTombstone('project', …)` added by KJC-BUG-0050 is replaced by a `plan.updatedAt > tombstone.deleted_at` comparison. A tombstoned project revives only when the plan is genuinely newer than the delete; stale plans on disk are ignored and removed.
  2. **`ephemeral-cleaner.js` — tombstone + fs cleanup**: when wiping ephemeral projects at boot (`s_*`, `plan-*`, `tmp_*`, …) it now writes a tombstone and `rm -rf`'s `hu-stories/<id>/`, `sessions/<id>/` and `~/.kj/plans/<id>/`. Previously it only deleted the DB row, so the orphan directories revived the project on the next scan.
  3. **`sync.js::fullScan` — boot GC**: sweeps orphan tombstoned directories at startup (the "manual DB wipe" case).
  4. **`routes/api.js` `DELETE /api/projects/:id`**: honours `KJ_PLANS_DIR` instead of the hardcoded plans path.
- New `getTombstone(type, id)` helper in `packages/hu-board/src/db.js`.
- **Silent board-start failure** (#753). `kj board start` could exit `0` without writing a single line to `hu-board.log`. The daemon's entry-point guard compared `import.meta.url` against a hand-built `file://` + `process.argv[1]` string, which wrongly returned false on Windows (backslashes), linked / global installs (symlinks resolved on only one side) and paths with spaces — so `main()` never ran and the launcher reported a phantom success.
  - `server.js`: `isDaemonEntryPoint()` trusts an explicit `KJ_BOARD_DAEMON=1` flag set by the launcher, with a normalised `pathToFileURL` + `realpathSync` comparison as fallback.
  - `server.js`: `uncaughtException` / `unhandledRejection` handlers log the stack before exiting non-zero; `initDb()` reports an actionable message when the `better-sqlite3` native module fails to load.
  - `board.js`: `waitForEarlyExit()` detects a daemon that dies on boot, so `kj board start` surfaces the real failure instead of reporting a phantom PID.

### Internal

- 5 new unit tests for KJC-BUG-0055: 4 in `tombstones.test.js` (temporal gate revive / no-revive paths + fullScan GC) and 1 in `ephemeral-cleaner.test.js` (tombstone + fs removal on ephemeral cleanup).
- 5 new unit tests for the board-start fix: 3 in `tests/board/board-silent-start.test.js` (`waitForEarlyExit`) and 2 in `packages/hu-board/tests/server-daemon-guard.test.js` (`isDaemonEntryPoint`).

## [2.17.0] - 2026-05-18

Minor release. `kj audit` gains two new deterministic structural collectors (knip dead-exports + madge circular-deps) and the Sonar false-positive filter from v2.16 is generalised to apply across every collector. Engine pin bumped to Node ≥ 20.19 (knip 6.x requirement).

4 872/4 872 tests passing across 402 test files.

### Added

- **KJC-TSK v2.17 — Madge circular-import collector** (#744). New deterministic collector for the `architecture` dimension. Detects circular import chains via madge. Stack-aware: skipped on non-JS/TS projects. Severity heuristic: chain ≥ 4 files = MAJOR, shorter = MINOR. Honours `tsconfig.json` / `jsconfig.json` for path-alias resolution. 60 s timeout. Findings pass through the audit FP filter.
- **KJC-TSK v2.17 — Knip dead-exports collector** (#745). New deterministic collector for the `codeQuality` dimension. Reports unused exports / types (MINOR) and unused files (MAJOR). Stack-aware: skipped on non-JS/TS or missing `package.json`. Invoked as subprocess via `--reporter json`. 120 s timeout. Findings pass through the audit FP filter.
- **Generalised audit FP filter** (#743). Sonar-specific `src/sonar/issue-filter.js` from v2.16.0 moved to `src/audit/issue-filter.js` with a new `tool` field. Every collector — sonar, knip, madge, osv, semgrep — uses the same two mechanisms: static rules in `config.audit.false_positives` and inline marker `// karajan-audit-ignore: <tool>:<ruleId>`. Backwards compatible: compat shim re-exports from the old path, legacy `config.sonar.false_positives` and `// karajan-sonar-ignore: <ruleId>` markers keep working.
- **Built-in FP catalogue** (#746). Four entries shipped by default:
  - `knip:unused-files` in `tests/fixtures/` (loaded by path, not import).
  - `knip:unused-files` in `examples/` (user-facing entry points).
  - `knip:unused-exports` on `index.{js,ts,mjs,cjs,jsx,tsx}` barrels.
  - `madge:circular-import` in `node_modules/` (defensive).

### Changed (BREAKING engines)

- **Node engine: `>=20.10.0` → `>=20.19.0`**. Required by knip 6.x. Same pattern as the v2.8.0 bump (Node 18 → 20.10). Users on Node 20.10–20.18 must upgrade to 20.19+ or 22.12+.

### Internal

- 26 new unit tests (10 madge + 7 knip + 5 cross-tool filter + 4 built-in FP catalogue).
- SEA build: `madge`, `knip`, `oxc-parser`, `oxc-resolver` added to esbuild externals. Collectors degrade gracefully in the SEA binary (`require.resolve` throws → `available:false`); npm installs work normally.
- Dynamic-import budget 160 → 161 (lazy `await import("madge")` in `circular-deps.js`).
- `docs/audit-false-positives.md` extended with config schema, inline marker syntax, built-in catalogue table, and stack-gating table for all 5 collectors.

## [2.16.0] - 2026-05-18

Minor release centrada en calidad: filtro determinístico de falsos positivos Sonar (config + inline ignores), cierre del wire universal de Brain Recovery con el `semantic-detector`, codemod `replace`/g → `replaceAll`/g (41 sitios) y limpieza de hallazgos del propio `kj audit` v2.15.0.

4 846/4 846 tests passing across 401 test files.

### Added

- **KJC-TSK-0416** — Pre-filtro determinístico de falsos positivos Sonar (#741). Antes de mandar issues al coder (rol `sonar-role`) o al auditor, se filtran por:
  1. **Rules estáticas**: `{ rule, filePattern, reason }`. Catálogo built-in (incluye `javascript:S2699` para `tests/architecture/` — fallan vía `expect(offenders, msg).toEqual([])` y Sonar no detecta el assert con mensaje custom). Extensible por proyecto vía `config.sonar.false_positives`.
  2. **Inline ignore**: `// karajan-sonar-ignore: <ruleId>` en la línea del issue (o la anterior) suprime ese hit exacto. Útil para falsos positivos puntuales sin tocar config.
  Issues filtrados quedan registrados con `_suppressedBy` para auditoría. Resultado: el coder deja de quemar tokens "arreglando" cosas que no están rotas.

### Fixed

- **KJC-TSK-0413 step D** — Wire del `semantic-detector` vía adapter a `withBrainRecovery` (#739). El módulo usaba la signature legacy `runTask(prompt, opts)` mientras el wrapper espera `runTask({ prompt, timeoutMs })`. Adapter inline en el módulo. Completa el wire universal de Brain Recovery: ahora **todas** las llamadas IA del pipeline pasan por el clasificador.
- **Codemod `replace` → `replaceAll`** (#738). 41 ocurrencias de `.replace(/regex/g, ...)` migradas a `.replaceAll(/regex/g, ...)` en `src/`. Mismo resultado, semántica explícita (replaceAll exige flag global, `replace(/regex/g, …)` lo hacía por accidente). Detectado por `kj audit` v2.15.0 como hint de modernización ES2024.
- **Audit cleanup BLOCKER false positives** (#740). Refactorizado `expect(offenders, msg).toEqual([])` → `expect(offenders).toEqual([])` con mensaje en variable previa para que Sonar detecte el assert. Reduce BLOCKER count del audit en 11 (todos eran asserts custom con mensaje, no test sin assert real).

### Internal

- `planCommand` alias eliminado → `planGenerateCommand` (16 call sites en tests). Cero alias muertos en superficie pública del CLI.
- Tests Brain Recovery skip-on-fail confirmado en `semantic-detector` (test env: el sleep es no-op, abort viene rápido, best-effort intacto).

## [2.15.0] - 2026-05-17

Minor release. Tres epics completos sumando 30+ commits y ~4 000 LOC: self-healing de plans, model routing per HU con cross-provider review y undo, y un sistema completo de recuperación ante fallos de IA (rate limit, quota daily/monthly, network, silenced) con hibernación persistente y fallback chain.

4 835/4 835 tests passing across 400 test files.

### Added — Epic Brain Recovery (KJC-PCS-0044)

- **KJC-TSK-0411** — Universal agent error classifier (#722). Clasifica cualquier fallo de IA en 7 clases con metadata accionable: RATE_LIMIT_SHORT, QUOTA_EXHAUSTED_DAILY, QUOTA_EXHAUSTED_MONTHLY, API_DOWN, AUTH_FAILED, NETWORK_TIMEOUT, SILENCED, UNKNOWN_FATAL. Parsers per-provider (claude, codex, gemini, opencode).
- **KJC-TSK-0412** — withBrainRecovery wrapper (#724). Política central de retry/standby/backoff/hibernate/abort según clase. Backoff exponencial con jitter, observabilidad vía emitter.
- **KJC-TSK-0413** — Wire universal del wrapper (#726, #727, #728). TODA invocación a agente IA pasa por Brain Recovery. Coverage: plan-reviewer, plan-fixer, tests-synthesizer, planner, coder, reviewer, hu-reviewer, security, audit, refactorer, architect, discover, researcher, triage, solomon, lazy-planner, hu-splitter, kj triage/architect/researcher/discover standalone.
- **KJC-TSK-0414** — Hibernación persistente (#729, #733, #734, #735). standby-store al disco + scheduler event-driven (setTimeout único per session, sin polling). reconcileAll() al arrancar el board. Comandos `kj standby list` + `kj standby resume <id>`. GC extendido limpia standby/done > 7d, audits > 30d, hu-board-runs > 30d. UI board: banner sticky con countdown HH:MM:SS.
- **KJC-TSK-0415** — Plan B fallback chain (#736). Anthropic introduce \$200/mes Agent SDK desde 15-jun-2026 — agotarlo bloquearía runs 30 días. Cuando QUOTA_EXHAUSTED_* con retryAfter > max_wait_hours (default 12h) y hay fallback configurado, Brain switchea al provider alternativo. Recursivo (claude → codex → opencode). Configurable per rol. Wizard `kj init` extendido.

### Added — Epic Model Routing + Undo (KJC-PCS-0043)

- **KJC-TSK-0405** — Model router por HU (#715, #719). Cada HU lleva coder_model + reviewer_model asignados automáticamente según complexity. Reviewer cross-provider del coder por defecto (claude↔codex).
- **KJC-TSK-0406** — Override modelos desde el board (#717). Modal HU expone inputs para overridear coder/reviewer por HU.
- **KJC-TSK-0407** — Sección `model_routing` en config schema (#716).
- **KJC-TSK-0410** — opencode + aider first-class en model-router (#721).
- **KJC-TSK-0408** — Undo per HU con snapshots git (#718, #720). Ref git pre-coder + botón ⏪ Undo en modal → reset --hard → status=pending.

### Added — Epic Self-Healing Plan (KJC-PCS-0042)

- **KJC-BUG-0053** — plan-fixer asigna short_id + blocked_by a HUs añadidas (#707).
- **KJC-BUG-0054** — Convergence guard inteligente (priority vs secondary) (#708).
- **KJC-TSK-0399** — Structural integrity pass post-review (#709). Rompe ciclos (DFS), elimina blocked_by huérfanos, AUTOFIX-NNN para short_id missing.
- **KJC-TSK-0400** — Skip Sonar/TDD/tests en HUs no-code (#710). Nuevos task_types `spike` y `research`. Title prefix [SPIKE]/[DOC]/[RESEARCH] → task_type inferido.
- **KJC-TSK-0401** — Validación estructural en PATCH blocked_by (#711). Rechaza ciclos + refs huérfanas con HTTP 400.
- **KJC-TSK-0402** — `kj plan fix [planId] [--prompt]` (#712). Re-corre reviewer + self-fix + structural pass sobre plan existente.
- **KJC-TSK-0403** — Eliminar columna Failed del board (#713). status/result ortogonal: HUs fallidas vuelven a Pending con badge ✗.
- **KJC-TSK-0404 step 1** — Zombie reaper marca result=fail + blocker (#714).

### Internal

- 4 835/4 835 tests passing (era ~4 700 en v2.14.3). 400 test files.
- 30+ commits desde v2.14.3, todos pasando shrink-budget (≤ 200 LOC neto por PR salvo 4 exclusiones cohesivas con `large-pr-justified`).

## [2.14.3] - 2026-05-13

Patch. Tres mejoras al sistema de preflight detectadas al lanzar el primer `kj run` real sobre un proyecto greenfield (greta-app).

### Fixed

- **KJC-BUG-0049 (fix puntual)** — `preflight` ya no aborta cuando `gh` está autenticado por keyring/OAuth (caso default tras `gh auth login --web`) sin `GH_TOKEN` en env (#690). El check ejecuta `gh auth status` como fallback antes de fallar.

### Added

- **KJC-BUG-0049 (fix arquitectural)** — Sistema de checks **degradables** (#691). Nuevo campo `Check.degradable` con shape `{ disables: ["git.auto_pr", ...], warn: "mensaje" }`. Cuando un check degradable falla, el preflight NO aborta: desactiva los flags listados y emite WARN. La sesión continúa con esas features off. Aplicado a `token:gh`: si `gh` no está auth, se desactivan `auto_pr` + `auto_push` y el coder sigue haciendo commits locales. Reemplaza el patrón "fail-closed" rígido por "degrade-or-fail" según la naturaleza del check.

- **KJC-TSK-0393** — Project-aware preflight (#691). Nuevo módulo `src/checks/project-checks.js` con signal detection + checks dinámicos basados en el proyecto real:
  - **Signals detectados**: `node` (package.json), `docker` (Dockerfile/compose), `firebase` (firebase.json/.firebaserc), `python` (pyproject.toml/requirements.txt/setup.py), `rust` (Cargo.toml), `go` (go.mod), `terraform` (*.tf), `env-example` (.env.example/.sample/.template), `env` (.env).
  - **Checks dinámicos**:
    - `project:kj-init-ran` — avisa si falta config Karajan global Y local
    - `project:write-perms` — verifica permisos de escritura en projectDir + .kj/ + .karajan/
    - `project:tool:<docker|firebase|python3|cargo|go|terraform>` — solo aplica cuando el signal está, comprueba que la tool está instalada con install command ejecutable
    - `project:env-consistency` — lista variables faltantes en .env vs .env.example
    - `project:gh-remote-access` — degradable, ejecuta `git ls-remote --heads origin` para validar acceso al remote real (no solo `gh auth status` global)
  - Integrado en preflight extended phase de `kj run` automáticamente.
  - **Comando nuevo**: `kj doctor --project` ejecuta SOLO esta fase. Útil para validar un proyecto antes de `kj run` sin re-correr todos los checks globales (CLIs, node, sonar, etc.).

### Tests
- 4 nuevos en `runner.test.js` para degradable
- 15 nuevos en `project-checks.test.js`
- Suite total: **4608/4608** verde (+24)

## [2.14.2] - 2026-05-12

Patch release. Dogfooding GRETA Plan 2 v2.14.1 reveló 2 bugs UX + 1 gap de documentación:

### Fixed

- **KJC-BUG-0048** — Botón ▶ Run en cards del HU Board ya no aparece en HUs con `blocked_by` no resueltas (#687). `canRunHu` en `packages/hu-board/public/app.js` solo miraba `status + testCount`; ahora añade `&& blockedBy.length === 0`. Las 19/58 HUs entry-point siguen mostrando ▶; las 39 con deps muestran solo "⏳ waits for: …" hasta que sus deps se certifiquen.

### Added

- **`[EPICA]` prefix** automático en titles del planner (#687). El prompt ahora exige que `description` empiece con `[EPICA] one-sentence description`. El planner extrae las épicas de headings del SPEC (`### Épica NOMBRE`) y prefija cada HU. Fallbacks: `[INFRA]` para setup, `[SHARED]` para cross-cutting. Tras dogfooding GRETA Plan 2: 62/62 HUs con prefix correcto (PROFILE, ASSESS, AI, IMPACT, GUARD, INFRA, CATALOG).
- **`docs/task-templates/spec-conventions.md`** (#688, KJC-TSK-0385). Documento central con las 6 convenciones que el planner v2.14.x entiende: épicas, scope exclusions, deps transversales, reuse, async observers, deps explícitas. Más antipatrones detectados en dogfooding y checklist pre-generación.
- **`plan-generate.md` updated** (#688): banner + 4 secciones 📘 con ejemplos de cada convención.

## [2.14.1] - 2026-05-12

Patch release. Dos patologías del planner descubiertas en dogfooding de GRETA Plan 2 contra v2.14.0:

### Fixed

- **KJC-BUG-0046 (P5)** — Self-fix loop ya no diverge sin convergencia (#684). Dogfooding mostró que el iter 2 del self-fix podía empeorar el plan (iter 1 reducía 15→10 issues, iter 2 subía a 17 al borrar HUs que iter 1 había añadido). Fix: snapshot del plan (deep clone de `plan.hus` + `plan.review`) ANTES de aplicar cada patch del fixer; tras re-review, si `newCount > currentCount`, restaurar snapshot y `break`. Log nuevo: `[planner] self-fix iter N regressed (X → Y) — reverted, stopping`.
- **KJC-BUG-0047 (P6)** — Planner ya no declara `blocked_by` sobre observers asíncronos (#685). Dogfooding mostró que el planner convertía "Y reacciona a X" en `blocked_by`, rompiendo el principio AVISA-no-BLOQUEA: HUs business marcaban como dependencia sus guardarraíles asíncronos. Fix: regla explícita en el prompt listando 6 patrones de async observers (guardrails/validators/monitors, cron jobs, webhooks/listeners, async queues/workers, audit logs/metrics, validators que corren después) + heurística "consume vs react": si X CONSUME un deliverable de Y antes de empezar → `blocked_by`. Si Y solo REACCIONA a X → paralelo, NO `blocked_by`.

### Dogfooding result

Regenerar Plan 2 GRETA con esta release iguala el baseline de v2.13.0 + parches iter 1 (9 findings sobre 58 HUs, 15% issue density) cuando v2.14.0 puro devolvía 17. Reducción del 47% en findings iniciales gracias a P6; P5 evita el regreso en cualquier iter 2.

## [2.14.0] - 2026-05-12

Quality pass — 16 PRs absorbiendo bugs blockers, patologías del planner detectadas durante el dogfooding de Plan 2 GRETA, hardening del HU Board, y la primera tanda de reorganización de tests (issue #368).

### Fixed — bugs blockers

- **KJC-BUG-0026** — Solomon ya no aprueba security blockers legítimos clasificados erróneamente como "style" (#665). Rule 6 (`reviewer_style_block`) ahora detecta security keywords (sql injection, xss, csrf, auth, password, secret, hash, traversal, …), severities altas (critical/high/blocker/major), y categorías security/correctness antes de clasificar como style.
- **KJC-BUG-0032** — Detección de leak filesystem con segunda capa: `detectTranscriptCdLeaks()` escanea el transcript del coder buscando `cd <abs-out-of-project> && <write-cmd>` (mkdir/touch/git init/pnpm init/echo >/...) que la snapshot-diff anterior no capturaba si el target ya existía (#666).
- **KJC-BUG-0035** — Sonar admin password rotation ya no falla silenciosamente: si `change_password` devuelve 403/500/400-sin-error-default/network error, `passwordRotationError` se propaga al caller y `kj init` lo logue como WARNING con instrucciones para rotar a mano (#672).

### Fixed — patologías del planner (P1-P4)

Detectadas en el dogfooding de Plan 2 GRETA (2026-05-11), donde el reviewer flagaba 4 huecos del SPEC en cada iteración:

- **P1 / KJC-BUG-0042** — Planner respeta exclusiones explícitas del scope (#667). `extractScopeExclusions(task)` detecta 6 patrones (ES + EN): "NO incluye en este plan: X, Y", "Out of scope: X", "Plan N handles: X", … y los renderiza como sección **FORBIDDEN scope** en el prompt.
- **P2 / KJC-BUG-0043** — Planner declara deps a TODOS los miembros de una categoría transversal (#668). Si una HU tiene AC tipo "listado transversal de warnings filtrables por guardrail", la dep es a `GUARD-001..N`, no solo a `GUARD-001`.
- **P3 / KJC-BUG-0044** — Nuevo campo `reuse` en step schema (#669). Si la funcionalidad ya está cubierta por otra HU, declara `reuse: ["<id>"]` en lugar de reimplementar. Wiring completo end-to-end: prompt, plan-hu-ops (addHu/removeHu/updateHu), generate.js.
- **P4 / KJC-BUG-0045** — Reviewer self-fix loop tras la primera review (#670 + #671). Nuevo módulo `src/plan/plan-fixer.js` con `applyReviewerFeedback` que pide al planner un patch estructurado (`additions`/`deps_to_add`/`deletions`) y `applyFixerPatch` que lo aplica in-place. Loop max=2 iter o hasta 0 findings. Skippable con `--no-plan-fixer`/`--quick`.

### Fixed — HU Board polish

- **KJC-BUG-0038** — Prompts zombi de runners crashed se limpian solos. `GET /api/prompts` aplica TTL 30 min sobre `createdAt` (fallback a `mtime`); más viejo → unlink + tombstone + skip (#673). Cubre Solomon escalations legítimamente largas pero no deja la UI bloqueada por archivos huérfanos.
- **KJC-BUG-0039** — Rate-limit menos agresivo y SSE exento (#674). Default 300→600 req/min, env var `HU_BOARD_RATE_LIMIT` para override, `skip:` para `/api/events` (SSE persistente + reconnects automáticos del browser no deberían contar contra el budget).

### Closed without code change

- **KJC-BUG-0027** — Scope guard `max_files_per_iteration` ya fue retirado en v2.0.0 (PR #357 / commit 906a4273). Coder prompt ahora enforce atomic commits sin guard hard-coded por número de archivos. Card movida a Closed con commits + rootCause + resolution.

### Refactor — tests folder reorganization (issue #368, parcial)

5 PRs movieron ~93 archivos `*.test.js` de `tests/` root a subcarpetas espejo de `src/`:

- #675 `tests/plan/` (14 archivos)
- #676 `tests/hu/` (7 archivos)
- #677 `tests/sonar/` (14 archivos)
- #678 `tests/board/`, `tests/session/`, `tests/triage/`, `tests/domain/` (23 archivos)
- #679 `tests/agents/`, `tests/brain/`, `tests/reviewer/`, `tests/security/`, `tests/utils/`, `tests/coder/`, `tests/solomon/`, `tests/skills/`, `tests/roles/` (35 archivos)

Cambios puramente mecánicos: `git mv` + sed para 6 patrones de imports (`from`, `vi.mock`, `vi.doMock`, `import()`, `./fixtures`, `import.meta.dirname` patterns). Quedan ~170 archivos en root para próximas oleadas.

### Tests

Suite de 4577 tests verde durante toda la sesión. 16 PRs mergeadas, **0 regresiones**.

## [2.13.0] - 2026-05-11

Minor release. **HU Board hardening pass.** Cinco PRs centradas en
hacer el board resiliente y autoreparable tras la sesión de
dogfooding del 2026-05-10 que reveló cuatro patologías acumuladas
(modal "Karajan needs an answer" zombi del 7 de mayo bloqueando
toda la UI, 18 proyectos zombi reapareciendo tras cada `kj board
start`, cache HTTP del navegador sirviendo HTML/JS antiguos tras
restart del server, modal con fondo transparente porque
`var(--bg-secondary)` nunca estaba declarada). Cero parches sueltos
— refactor estructural por causa raíz.

### Added

- **Tombstones — delete persistente que sobrevive a fullScan**
  (`KJC-TSK-0380`, #655/#656/#657). El board reconstruía la DB
  SQLite desde el filesystem en cada sync y revertía silenciosamente
  cualquier delete por API. Solución: tabla `tombstones (resource_type,
  resource_id, deleted_at, source, fs_paths)` que registra los ids
  que el usuario enterró; los syncs consultan la tombstone ANTES de
  upsert y, si está, hacen `rm -rf` del path del filesystem y
  abortan. Patrón clásico de Cassandra/Riak. Permanentes por diseño,
  restauración explícita vía endpoint.
- **Endpoints DELETE reforzados + nuevos** — `/api/projects/:id`,
  `/api/stories/:id`, `/api/sessions/:id` ahora tombstone + `rm -rf`
  del fs path correspondiente. Nuevos: `/api/prompts/:id`,
  `/api/plans/:planId`, `GET /api/tombstones`,
  `POST /api/tombstones/:type/:id/restore`.
- **Nuevo comando `kj board cleanup`** (`KJC-TSK-0380` PR-C, #657)
  detecta y borra: proyectos efímeros (`tmp_*`/`test_*`/`demo_*`/
  `kj-test-*`/`s_*`/`plan-*` con >7d sin actividad), prompts
  huérfanos (sin `.answer.json` y mtime >24h), directorios de
  sesión huérfanos. Soporta `--dry-run`. Resuelve los ~20 zombis
  acumulados en una pasada.
- **Server-restart detector + `/api/version`** (`KJC-TSK-0379`,
  #654). El cliente polea `/api/version` cada 30s; si `boot_time`
  cambia (server reiniciado), `forceRefresh()` automático: limpia
  caches y recarga. El usuario ya no tiene que cerrar pestañas o
  hacer Clear Site Data tras un `kj board stop` + `kj board start`.
- **Botón 🧹 manual** en el header del HU Board (escotilla manual
  para los casos en que el polling todavía no ha disparado pero algo
  visualmente no cuadra).

### Changed

- **`Cache-Control: no-store, must-revalidate`** para HTML/JS/CSS
  servidos por el board (#654). ETag + Last-Modified desactivados.
  Garantiza que el primer request tras un restart trae el código
  nuevo, sin revalidación condicional que el navegador pueda
  saltarse.
- **HU Board v2.10 rate-limit** documentado como problema en
  `KJC-BUG-0039` (no fix en este release; aterrizará después).

### Fixed

- **Modal del prompt transparente** (#658). `var(--bg-secondary)`
  estaba referenciada en 8 sitios de `app.js` (modal, textareas,
  inputs) pero nunca declarada en `:root` → fallback a `transparent`
  → cards visibles detrás del modal. Fix: declarar la variable en
  `:root` con `#131a30`. Una línea CSS, ocho consumidores corregidos.
- **Empty-state del HU Board mostraba ☐** (cuadrado vacío Unicode
  U+2610) sin estilo coherente (#658). Eliminado del template; el
  title + text + path son suficientes para transmitir "no hay nada".
- **Causa raíz de modales zombi** (`KJC-BUG-0038`) absorbida por el
  refactor de tombstones — ya no hay forma de que un prompt huérfano
  bloquee la UI.

### Documentation

- **Glosario de tombstones** implícito en CHANGELOG y comentarios
  inline. Patrón explicado en cada writer/reader que lo consulta.



Minor release. Two new quality-measurement features land together: a
per-run **plan adherence** score and a **golden-tasks** regression suite
for cross-version output-quality detection. Plus a CI policy refinement
that frees documentation from the LOC budget while keeping AI-rule
files (CLAUDE.md, AGENTS.md, role prompts) capped.

### Added

- **Plan adherence metric** (`KJC-TSK-0376`, #645/#646) — every `kj run`
  that executes against a known plan now computes a deterministic 0–100
  score in `summary.md` answering *"did the coder follow the plan?"*.
  Four weighted components (commit attribution 40%, acceptance tests
  30%, scope discipline 20%, dependency order 10%) reported in a
  breakdown table. Pure offline calculation — no LLM, no extra cost.
  Spec in `docs/plan-adherence.md`. Inspired by deepeval, kept fully
  deterministic for reproducibility (golden-task suite friendly).

- **Golden tasks regression suite** (`KJC-TSK-0374`, #648/#650/#651) —
  a small set of canonical tasks (`todo-rest-api`, `npm-package-cli`,
  `react-counter-component`) executed before every release to detect
  output-quality regressions between Karajan versions. Five assertion
  families per task: commits-min, audit status, plan adherence,
  expected test files, allowed LOC range. All deterministic — no LLM
  judge. Library-only in this release; CLI integration is a follow-up
  task. Spec in `docs/golden-tasks.md`.

### Changed

- **Shrink-budget gate refined** (#649) — `*.md` files used to count
  toward the 200-LOC PR limit, which forced trimming of legitimate
  documentation. Human-facing docs (`docs/**`, `CHANGELOG.md`,
  `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `MIGRATION*.md`,
  `TODO*.md`) are now excluded. AI-rule files (`CLAUDE.md`,
  `AGENTS.md`, `templates/**/*.md` — role prompts, coder/review rules)
  still count, since unbounded growth there dilutes the agent's
  context.

### Documentation

- **Plan adherence spec** (`docs/plan-adherence.md`) — full reference
  for the new metric: components, attribution rules, output shape,
  when the section is omitted, why no LLM judge.

- **Golden tasks spec** (`docs/golden-tasks.md`) — full reference for
  the regression suite: how it works, the 3 tasks, schema, baseline
  format, when the suite runs.

- **Audit false positives registry** (`KJC-TSK-0353`, #578) — new
  `docs/audit-false-positives.md` recording the 4 dependencies that
  `kj audit` flags as unused but are actually used via indirect
  mechanisms (config files, hooks, `npx` from scripts): `@changesets/cli`,
  `@vitest/coverage-v8`, `postject`, `simple-git-hooks`. Future audits
  skip the same investigation. Re-confirmed live in N8 audit
  (2026-05-07). No code or dependency changes.

## [2.11.0] - 2026-05-08

Minor release. Two-day dogfooding pass (10-level test plan) surfaced and
fixed a long tail of UX papercuts, two latent zombi-status bugs, and the
HU sub-pipeline branch-creation regression on fresh repos. All N0–N8
levels are now re-validated green; N9 is the human rehearsal step. Two
small `hu-board` features land alongside the fixes: an automatic cleanup
of ephemeral test projects at boot and an in-UI help modal + tooltips
for the five header views.

### Added — `hu-board`

- **Auto-cleanup of ephemeral test projects** (`KJC-TSK-0371`, #627). On board
  start, any project whose id matches `/^(tmp_|test_|demo_|kj-test-)/i`
  AND has been inactive for >24h is cascade-deleted (project + stories +
  sessions). A new `is_test` column on `projects` lets the user override
  per-project: `1` forces ephemeral, `0` pins forever, `null` follows the
  default heuristic. New `PATCH /api/projects/:id/is-test` endpoint and
  a 3-state toggle button on each project card.
- **In-UI help and tab tooltips** (`KJC-TSK-0372`, #628). New `?` button
  in the header opens a modal explaining each of the five views. Every
  nav tab carries a native `title` attribute for the standard hover
  tooltip.

### Fixed — pipeline reliability

- **Session-level status zombi** (`KJC-BUG-0037`, #635). Several `runFlow`
  exit paths returned `{approved: true}` upstream without sealing
  `session.status`, leaving runs at `running` indefinitely. New boundary
  guard `sealSessionStatusIfStillRunning` at the runFlow return points
  maps the result shape to the terminal status (`approved` / `paused` /
  `cancelled` / `failed`); idempotent + never-throws.
- **`SonarStage` no longer loops on remoteless repos** (`KJC-TSK-0373`,
  #624 + #633). The audit collector skipped Sonar cleanly when no git
  remote was configured, but the run-loop SonarStage hit the same
  scanner code path and threw `Missing git remote.origin.url` on every
  iteration — Brain exhausted `max_iterations` and finalised via the
  "approved-by-exhaustion" fallback without ever running Sonar. New
  shared `canResolveSonarProjectKey` predicate skips the stage cleanly.
- **`commitAll` race tolerance** (#633). Post-loop sometimes saw
  `hasChanges()` return true after `git add -A` but `git commit` then
  refused with locale-specific "nothing to commit" / "nada para hacer
  commit". The thrown error escalated to Solomon and the journal writer
  was skipped. `commitAll` now matches en/es/de/fr "nothing to commit"
  and returns `{committed: false}` cleanly.
- **HU branch fallback when `main` doesn't exist** (#636). `git init -q`
  on a fresh `/tmp/...` repo with `init.defaultBranch=master` produced
  7 identical "branch 'main' is not a commit" warnings during N6 plan
  flow, and every HU silently fell back to the original branch. New
  `resolveExistingBranchRef` probes the configured base, then `main`,
  `master`, `HEAD`; uses the first ref that exists.
- **`writeConfig` strips runtime-only keys** (`KJC-BUG-0036`, #629).
  The loader synthesised `_deprecated.sonarqubeEnabledKey` and the
  wizard used `sonarqube.enabled` as a transient hint, but
  `writeConfig` serialised both — fossilising the deprecation warning
  on disk. New `stripRuntimeOnlyKeys` removes both before serialisation.
- **`addyosmani-catalog` recovers from upstream force-push**
  (`KJC-BUG-0033`, #625). When the cached catalog's upstream rewrites
  history, `git pull --ff-only` fails permanently. New fallback runs
  `git fetch --depth 1 origin HEAD` + `git reset --hard FETCH_HEAD`.
- **`kj init` no longer writes deprecated `sonarqube.enabled`**
  (`KJC-BUG-0034`, #626). Wizard answer survived in memory as a hint
  for `setupSonarQube`, but the persisted YAML now drops the key.

### Fixed — UX / display

- **Sonar `SKIPPED` renders gray, not red, in the result banner** (#634).
  Pre-fix, every non-OK gateStatus painted red, so a clean run with a
  legitimate `SKIPPED` looked like a failure. Three buckets now: `OK`
  → green, `SKIPPED` / `PENDING` → gray, anything else → red.
- **Result panel + summary list every commit the run produced**
  (`KJC-TSK-0373` follow-up, #632). `gitResult.commits` only carried
  the post-loop scaffold commit; the coder's commits had no journal
  owner. New `listCommitsBetween(fromSha)` helper queries git directly.
  New `session.head_at_start` field captures actual HEAD at run start
  (separate from `base_ref` which can be the empty-tree SHA on
  single-commit repos).
- **Help text says `task` is REQUIRED** (#631). 8 commands (`kj run`,
  `kj code`, `kj review`, `kj plan generate`, `kj triage`,
  `kj researcher`, `kj architect`, `kj discover`) advertised the
  positional as `[task]` (commander's "optional" syntax) but the
  runtime requires either the positional or `--task-file`. Description
  updated to "Task description (REQUIRED — provide as argument or via
  --task-file)". `kj audit` is intentionally untouched.

### Documentation

- **`docs/dogfooding-levels.md`** (#630, #637). New 10-level test plan
  reconstructed from the JSONL transcript after a context compaction.
  Each level has a Histórico / Re-validado entry from the 2026-05-07
  dogfooding pass.

## [2.10.2] - 2026-05-07

Patch release. Pure UX improvement on `kj init`: the wizard goes from
9 prompts (covering ~30% of the meaningful runtime knobs) to a full
setup that lets the user pick a CLI per role, auto-generates the
SonarQube analysis token via REST API, and exposes the git automation
+ HU Board security flags. No API changes; safe upgrade from 2.10.1.

### Added — `kj init` wizard expansion (`KJC-TSK-0367`, #616)

- **Per-role provider selection**. For each of `planner`, `researcher`,
  `architect`, `refactorer`, `tester`, `security`, `solomon`,
  `impeccable`, `perf`, `hu_reviewer`: choose **inherit from
  coder/reviewer** (default), **pick a specific CLI**
  (claude/codex/gemini/opencode/...), or **disable the role** when
  allowed. Defensive: initialises missing role/pipeline entries on
  configs coming from older versions, so re-running on an upgraded
  install never crashes.
- **SonarQube token bootstrap**
  (`src/sonar/token-bootstrap.js`, NEW). After the Docker container
  is up:
  1. Probes `admin/admin` via `/api/authentication/validate`.
  2. **Rotates the default password** to a fresh 32-byte secret
     persisted at `~/.karajan/sonar.admin-password` (mode 0600).
     Removes the well-known credentials surface from the user's
     machine.
  3. Revokes any pre-existing `karajan-cli` token (idempotent
     re-runs).
  4. Generates a fresh `GLOBAL_ANALYSIS_TOKEN` via
     `POST /api/user_tokens/generate`.
  5. Persists at `~/.karajan/sonar.token` (mode 0600) **and**
     writes it into `config.sonarqube.token`.
  6. On any failure (401, network, etc.) returns `ok: false` and
     the wizard falls back to the manual instructions that existed
     before this card.
- **Git automation prompts**: `auto_commit`, `auto_push`, `auto_pr`
  booleans. `branch_prefix` asked only when `auto_commit` is on
  (default `feat/`).
- **HU Board security prompts** (only when HU Board is enabled):
  bind host (`127.0.0.1` default | `0.0.0.0` with auto-generated
  token enforced for non-loopback peers) and port.

### Tests

- `tests/init-wizard.test.js` extended:
  - Existing happy-path test updated to expect **15** `wizard.select`
    calls (2 agents + 10 per-role + 3 lang/methodology) instead of
    the pre-fix 5.
  - **4 new direct unit tests** for `askPerRoleProviders`.
  - **3 new tests** for `askGitAutomation`.
  - **4 new tests** for `askBoardSecurity`.
- `tests/sonar-token-bootstrap.test.js` (NEW, 5 tests): success path,
  admin/admin login fails, network error, password rotation rejected,
  token generation failure.
- Internal `__test__` named export on `init.js` so the sub-functions
  are testable without driving the whole `initCommand` pipeline.

**4 375 / 4 375** passing across 374 test files (was 4 359; +16 new).

### Documentation

- `docs/agents/SKILL.kj-init.md` updated to describe the 8 sections
  of the new wizard.

### Out of scope (deferred)

- Wizard reentrante (`kj init --role coder --change`).
- Stack-driven defaults (frontend project → impeccable on by default).
- SonarCloud token bootstrap (only the local container is covered).

## [2.10.1] - 2026-05-06

Patch release. One-line fix for a stdout contamination bug in
`kj audit --agent-readiness --json`, plus polish in the asciinema demo
scripts under `docs/demos/`. No API changes; safe upgrade from 2.10.0.

### Fixed

- **`kj audit --agent-readiness --json` no longer contaminates stdout
  with the `[info]` banner** (PR #613). Pre-fix, piping the JSON output
  into `jq` (e.g. `kj audit --agent-readiness --json | jq '.score'`)
  failed with a parse error because the logger emitted
  `Auditing agent-readiness of <path>` to stdout BEFORE the JSON
  document. The fix is a one-line guard in `src/commands/audit.js` that
  suppresses the banner whenever `--json` is set. Regression pin in
  `tests/e2e/07-kj-audit.test.js` asserts `r.stdout` starts with `{`
  and parses with `JSON.parse()` without preprocessing.

### Changed — demo scripts (`docs/demos/`)

- `agent-readiness.txt`: replace the `~/some-third-party-repo`
  placeholder with a concrete recommendation (clone `expressjs/express`
  — no llms.txt → low score → contrast vs Karajan's 100/100).
- `happy-path.txt`:
  - Realistic timing (~5–10 min, not ~3 — asciinema's idle-time
    collapse doesn't apply to a live audience).
  - Add `--auto-commit` to the hero `kj run` so commits actually
    appear in `git log`.
  - `npm install --silent` before `npm test` (safety net — coder may
    not run install on its own).
  - Drop `--dimensions architecture` from the closing audit (no-op
    when combined with `--deterministic-only`).
  - Replace `cat package.json | head -15` with `head -15 package.json`.

### Added

- **Pre-talk code review backlog** — 3 Sonnet agents in parallel
  surfaced P1/P2 latent bugs and test gaps. None affect the live
  demo on 2026-05-21; all deferred to post-talk. (Backlog lives
  in the maintainer's private notes, not in this repo.)

### Tests

- 4 359 / 4 359 passing (was 4 358; +1 regression test for the
  showstopper).

## [2.10.0] - 2026-05-05

Agent-readiness release — Karajan becomes the first orchestrator with a
full agent-readability surface (llms.txt + a SKILL.md per CLI command +
a static auditor that scores any third-party repo for the same shape).
Plus a webperf quality gate inside the iteration loop, hu-board security
hardening, and a skills mapper that auto-pulls WCAG context for a11y
tasks. Five PRs merged. Zero breaking changes; opt-in flags throughout.

### Added — agent-readiness surface

- **`kj audit --agent-readiness`** (`KJC-TSK-0350`, #609). Static, LLM-
  free score for any repo against seven checks: llms.txt presence,
  llms.txt validity (sections + links), robots.txt AI-bot allowlist,
  per-doc token budget (≤ 32 KB), heading hierarchy, agents/README.md
  entry point, SKILL.md coverage. Output: 0–100 score, per-check ✓/✗,
  ranked top-fixes list. `--json` for CI; pure data transformation
  (no network, no LLM, no side effects). Two detector bug fixes that
  brought Karajan-on-Karajan from 80 → 100/100: bash comments inside
  fenced code blocks no longer count as H1, and `<h1 align="center">`
  HTML banners are now recognised as valid H1s.
- **SKILL.md per CLI subcommand** (`KJC-TSK-0349`, #608). Six new
  `docs/agents/SKILL.kj-{doctor,init,board,review,resume,clean}.md`
  files, all following the established contract (What it does ·
  Inputs · Outputs · Constraints · Side effects · Common failure
  modes · Example · Related). Architectural test
  `tests/architecture/agent-readability.test.js` fails CI when a
  SKILL link in `llms.txt` no longer resolves or a SKILL.md drops a
  required section.
- **`docs/demos/`** (`KJC-TSK-0228`, #610). Three asciinema recording
  scripts (happy-path, agent-readiness, audit-with-llm) plus a README
  with terminal config, pre-recording checklist, embedding via
  `<asciinema-player>`, and a re-record cadence. Source-of-truth
  approach: scripts in repo, .cast files re-recorded per release.
- **`robots.txt`** at repo root. Explicit `Allow: /` for GPTBot,
  ClaudeBot, anthropic-ai, PerplexityBot, Google-Extended, CCBot.

### Added — webperf quality gate

- **`PerfStage` in iteration loop** (`KJC-TSK-0151`, #605). Wires
  `PerfRole` (#603) into `runQualityGateStages` after Impeccable when
  `pipeline.perf.enabled` is `true`. PASS verdict → iteration
  continues; FAIL verdict → reviewer feedback with concrete blocking
  metrics + top opportunities, iteration retries; scanner unavailable
  → log warn and skip (best-effort, never blocks the pipeline by
  itself). CLI/MCP parity: `--enable-perf` flag + matching
  `enablePerf` in `mcp/tools.js`, `mcp/run-kj.js`, sovereignty-guard
  allowlist, and `applySessionOverrides`. Default OFF.

### Added — skills mapper

- **a11y/WCAG/ARIA pattern in `TASK_PATTERN_TO_SLUG`**
  (`KJC-TSK-0351`, #606). Tasks mentioning accessibility / a11y /
  WCAG / ARIA / screen reader / keyboard navigation auto-pull the
  `frontend-ui-engineering` skill — until the upstream addyosmani
  catalog ships a dedicated a11y skill, that's the closest
  authoritative source for WCAG-aware UI work. 8 new positive task-
  text tests + 1 negative + 1 dedup guard.

### Changed — hu-board security hardening

- **Bind 127.0.0.1 by default** (`KJC-TSK-0355`, #607). Was binding
  all interfaces — fine on a personal laptop, problematic on shared
  WiFi with auto-discovery. New `kj board start --bind <host>` flag
  for the explicit \"expose on LAN\" case; banner emits a warning +
  token URL when binding non-loopback.
- **Auto-token, opt-in enforcement**. Token auto-generated at
  `~/.karajan/hu-board/token` (mode 0600, 32 random bytes hex,
  idempotent). Auth middleware only enforces the token for non-
  loopback peers — same-machine browser keeps working without
  `?token=` on every link. Three accepted carriers: `Authorization:
  Bearer`, `?token=`, `kj_board_token` cookie.
- **`helmet` middleware**: X-Content-Type-Options, X-Frame-Options,
  conservative CSP (allows inline scripts/styles for the existing
  dashboard), removes `X-Powered-By: Express`.
- **`express-rate-limit`** on `/api`: 300 req/min per IP, draft-7
  `RateLimit-*` headers.

### Tests

- Full suite: **4358/4358** passing (373 files), up from 4305 in v2.9.
- New: `tests/webperf/perf-stage.test.js` (5), bash-comment + HTML
  H1 regression tests in `tests/audit/agent-readiness.test.js` (12
  total), `tests/architecture/agent-readability.test.js` (4),
  `tests/skills/addyosmani-role-map.test.js` extended (28 total),
  `packages/hu-board/tests/{auth,security-middleware,token-store}.test.js`
  (175 total in the hu-board package).
- New `dynamic-imports.test.js` budget bump (159 → 160) for
  `PerfStage`'s feature-flag-gated brain-coordinator import.

### PRs merged in this cycle

| # | Card | Description |
|---|---|---|
| #605 | KJC-TSK-0151 | PerfStage + pipeline integration |
| #606 | KJC-TSK-0351 | a11y/WCAG/ARIA skills pattern |
| #607 | KJC-TSK-0355 | hu-board security hardening |
| #608 | KJC-TSK-0349 | SKILL.md per kj subcommand + coverage guard |
| #609 | KJC-TSK-0350 | --agent-readiness false-positives + 100/100 |

## [2.9.0] - 2026-05-04

Audit overhaul release — `kj audit` becomes a stack-aware, two-phase
analysis tool with deterministic security collectors (Sonar + OSV +
Semgrep), dimension auto-activation per project type, persistable
reports, token/cost transparency, and an interactive prompt that lets
the user inspect deterministic findings before paying for the LLM
phase. 13 PRs merged + 5-PR refactor (228 → 3 dead exports) +
detector false-positive cleanup. Zero breaking changes for MCP/pipeline
callers (the legacy `AuditRole.execute()` still chains both phases).

### Added — `kj audit` overhaul

- **Two-phase mode** (`KJC-TSK-0364`, #597). Deterministic findings
  print first; `Continue with LLM analysis? [y/N]` prompt before
  spending tokens. New `--deterministic-only` (zero-token mode) and
  `-y`/`--yes` (auto-confirm). CI/non-TTY paths auto-confirm. `--json`
  bypasses the prompt to keep stdout pipeable.
- **Project stack detection** in prompt (`KJC-TSK-0358`, #586). New
  `## Project Stack` section tells the LLM to filter heuristics by
  tier — frontend-only projects don't get N+1 query nags, backend-only
  projects don't get bundle-size nags, fullstack projects get both.
- **Accessibility dimension** (`KJC-TSK-0359`, #593). New WCAG 2.x
  audit auto-activated for frontend / fullstack / unknown stack;
  auto-skipped for backend-only (override with `--dimensions=accessibility`).
  Static checks for missing alt text, label-less inputs, heading
  hierarchy gaps, icon-only buttons without aria-label, ARIA misuse,
  focus management, colour-only signalling. Defers runtime contrast
  to axe-core/Lighthouse.
- **WebPerf section** (`KJC-TSK-0360`, #594). Frontend-perf hints
  (render-blocking, lazy loading, image format, CLS, font-display,
  critical CSS, third-party script facade pattern) when no live CWV
  measurement is available; renders the Core Web Vitals verdict when
  `config.webperf.lastResult` is present.
- **SonarQube findings** as deterministic prompt input (`KJC-TSK-0361`,
  #588). New `## SonarQube Findings` section with rule IDs + line
  precision; the LLM cross-references its own findings instead of
  guessing. `--no-sonar` to skip. Capped at 50 entries.
- **OSV-Scanner integration** (`KJC-TSK-0365`, #598). Best-effort
  collector that wraps `osv-scanner` for dependency vulnerability
  findings (broader DB than `npm audit`: GitHub Advisory Database +
  GLSA + Go vuln DB + others). Auto-skipped when not installed.
  Findings fold into the `security` dimension with CVE/GHSA as the
  rule. `--no-osv` flag.
- **Semgrep SAST integration** (`KJC-TSK-0366`, #600). Best-effort
  collector for static analysis findings (SQL/Cmd injection, XSS,
  hardcoded secrets, taint flow, language-specific anti-patterns).
  2000+ built-in rules via `--config auto`. CWE + OWASP metadata
  preserved. `--no-semgrep` flag.
- **Token/cost summary** (`KJC-TSK-0363`, #595). Every audit ends
  with `## LLM Usage` section: provider + model + duration + tokens
  + estimated cost in USD. Surfaces in stdout (markdown), `--json`
  output (top-level `usage` key), and persisted reports.
- **`--report-file` flag** (`KJC-TSK-0362`, #592). Persists the audit
  on disk in addition to stdout. Path is a file (extension drives
  format `.md` or `.json`) or a directory (auto-creates
  `audit-<ISO>.<md|json>`). `$KJ_AUDIT_REPORT_DIR` env var as default.
  Markdown reports get a reproducibility header (timestamp, project
  dir, branch + commit, invocation flags).

### Changed — `kj audit` parity bug fix

- **CLI now drives `AuditRole`** (`KJC-TSK-0357`, #585). Pre-patch the
  CLI re-implemented `createAgent + buildAuditPrompt + parseAuditOutput`
  inline, silently dropping the deterministic `basalCost`/`growthDelta`
  inputs that `AuditRole.execute()` collects when invoked via MCP.
  Same code path now means same prompt content for CLI and MCP.

### Fixed — `kj audit` detector accuracy

- **`findDeadExports` false positives reduced 166 → 4** (`KJC-TSK-0356`,
  #584). The `kj audit` detector now understands `@internal` JSDoc,
  `await import("path")`, `import * as ns from "..."`, and
  `export { x } from "y"` re-exports. Strings (template, double, single)
  are stripped before export-detection regexes so embedded sample
  source in test fixtures no longer pollutes findings. Result drops
  from 55x to 1.3x noise vs knip ground truth.

### Fixed — repo health (228 dead exports cleanup)

- **228 dead exports → 3** across `src/checks/`, `packages/hu-board/`,
  `src/orchestrator/`, `tests/fixtures/`, and the rest of `src/`.
  Splits across 5 atomic PRs (`KJC-TSK-0354 A-E`, #579-#583) so each
  bisect-friendly. Mix of demote-to-private (most), entirely-dead
  removal (a handful), and `@internal` JSDoc documentation for the
  6 helpers tests reach via dynamic import. Knip baseline drops from
  228 → 3.

### Test plan

Full suite **4305/4305 passing** (was 4199 at the start of the
release). 106 new tests added across 11 new test files in
`tests/audit/` plus targeted updates to `tests/command-audit.test.js`.

## [2.8.0] - 2026-04-30

Audit-driven hardening release. The 2026-04-30 self-audit (`kj audit`)
flagged 13 issues across security, code quality, performance, architecture,
and testing. This release closes all 13 plus several follow-ups surfaced
during the cleanup. 16 PRs merged, 0 user-visible API changes.

### Changed (BREAKING — runtime floor)

- **`engines.node` bumped from `>=18.0.0` → `>=20.10.0`** (PR #563). Node 18 LTS reached EOL on 2025-04-30; the codebase had been using ESM TLA, AbortController, fetch, structuredClone (all 18+), but the bump unlocks newer JS patterns and matches what CI was already running (vitest 4 / rolldown require Node 20.12+). CI matrix dropped Node 18 too.

### Added

- **FASE 1 e2e suite** (PR #570). 7 scenarios mapped to the 5-bug class from the 2026-04-27 demo regression: `01-plan-generate`, `02-run-plan-happy`, `03-run-single-hu` (zombie-HU), `04-reviewer-rejected` (saveSession-missing), `05-sonar-config-error` (Repairer unfixable), `06-dead-process` (zombi-status), `07-kj-audit`. Plus `tests/e2e/fixtures/fake-coder.js` and `fake-sonar-server.js` infrastructure so each test runs in <90s with no real LLM/network. Total e2e: 23 tests in 6s.
- **Per-directory coverage thresholds** in `vitest.config.js` (PR #566). Opt-in via `--coverage`: `src/agents/**` ≥80%, `src/mcp/handlers/**` ≥80%, `src/session/journal/**` ≥70%.
- **Node subpath imports map** in package.json (PR #565): `#utils/*`, `#session/*`, `#hu/*`, `#skills/*`. Eliminates `../../../` chains in orchestrator phase modules.

### Changed

- **`src/cli.js` split** from 699 LOC into 6 register modules (PR #567): `register-pipeline.js`, `register-plan.js`, `register-meta.js`, `register-roles-skills.js`, `register-sonar.js`, plus `_shared.js`. Entry point now 113 LOC. No CLI surface change.
- **`src/commands/plan.js` split** from 549 LOC into one file per sub-command under `src/commands/plan/` (PR #568). `plan.js` is a 14-LOC re-export shim; the 11 external callers don't change.
- **`src/orchestrator/drivers/iteration-loop.js` split** from 513 LOC → 311 LOC (PR #569). Five phase implementations moved to `iteration-phases/`: coder-and-refactorer, guards, quality-gates, reviewer-gate, handle-approved. Mirrors the established `pre-loop-phases/` pattern.
- **`src/orchestrator/drivers/pre-loop.js` split completed** (PR #560). Driver dropped 626 → 435 LOC by moving `emitConfigDeprecations`, `ensureAddyosmaniSkills`, and `maybeGenerateAutoHuBatch` into `pre-loop-phases/`.

### Fixed (security)

- **`execSync` / `execaCommand` → `execFileSync` / `execa` with arg arrays** (PRs #555 and #562). Closed 7 call sites where the legacy APIs accepted template strings with interpolated values. `baseRef` (session state) and similar inputs are no longer in shell-injection-vector shape. Sites: `verification-gate.js`, `derive-project-name-from-cwd.js`, `direct-actions.js`, `solomon-rules.js`, `cli.js`, `config-init.js`, `init-context.js`. After this batch, every child_process call in `src/` uses tokenised arg arrays.
- **`src/utils/task-file.js` re-throw without `cause`** (PR #563). Error chain was broken; wrapped with `{ cause: err }`.

### Fixed (correctness / quality)

- **57 ESLint warnings closed in src/** (PR #564). 44 `no-unused-vars` (orphan imports, dead code, args renamed to `_arg`), 10 `no-useless-assignment` (dead `let foo = init` + try/catch reset patterns), 4 `preserve-caught-error` (re-throws now preserve `cause`).
- **`activity-log.test.js` fixed-50ms sleeps replaced with `vi.waitFor`** (PR #561). Eliminates a CI flake class without changing assertions.
- **`adr-loader.js` and `garbage-collector.js` parallelised** (PR #558). Independent for-of+await loops now use `Promise.all(map(...))`. ADR loads drop ~5× FS round-trips → 1 burst; GC subroutines run concurrently across disjoint subtrees of `KJ_HOME`/`KARAJAN_HOME`.

### Infrastructure (lint hardening — defensive)

- **ESLint baseline extended to `tests/`** (PR #556). The same three "bug-killer" rules that protect `src/` (`no-undef`, `import-x/no-unresolved`, `import-x/named`) now apply to tests too. Surfaced and fixed 3 latent test bugs: literal multi-space regex, re-throw without cause, unsafe optional chaining.
- **`globalThis.__KJ_*` banned outside `src/config/test-harness.js`** (PR #557) via `no-restricted-syntax`. Stops the regression class where production code reaches into test-only override globals.
- **`no-console: error` outside CLI/display/logger paths** (PR #559). The 309 existing console.* calls were reviewed and all are justified (CLI commands, banners, structured logger). The rule prevents future debug prints from sneaking into the library layer.
- **ESLint warnings ratcheted to errors** (PR #564) for `no-unused-vars`, `no-useless-assignment`, `no-useless-escape`, `preserve-caught-error` in `src/`. Tests/ stays at `warn`.
- **Telemetry silent failures surface under `KJ_DEBUG=1`** (PR #563). `catch{}` was hiding DNS/network bugs in the telemetry pipeline; now writes a one-line diagnostic to stderr behind the env flag.

### Stale references and docs

- `docs/ARCHITECTURE.md` regenerated via `scripts/regen-arch-stats.sh`. Source: 43k LOC / 327 files; tests: 356 files / 4199 passing.
- Stale comments referencing the old `globalThis.__KJ_*` shape refreshed across `preflight-checks.js`, `iteration-loop.js`, `semantic-detector.js` to point at the typed `config.testHarness.*` getters (PR #563).

## [2.7.4] - 2026-04-24

### Changed (BREAKING contract, backward-compatible API)

- **Sonar is now intrinsic to Karajan for code tasks** (PR #468). Sonar runs unconditionally for every task classified as `sw`/`refactor`/`add-tests` and is skipped by policy for non-code tasks (`audit`/`doc`/`infra`/`analysis`/`no-code`). The `sonarqube.enabled` field in `kj.config.yml` is now **IGNORED** (with a deprecation warning emitted at run start). `--no-sonar` / `--sonar=false` CLI flags are also ignored with the same warning. Rationale: a code task without a quality gate, static analysis and issue enforcement is not a job Karajan can call complete — Sonar is part of the contract, like TDD. Solomon may still decide to skip a single iteration via runtime rule alerts (legitimate runtime override based on evidence); that path is unchanged. Users CANNOT pre-disable Sonar at config or flag level anymore. A new architectural invariant (`tests/architecture/sonar-intrinsic.test.js`) fails CI if anyone tries to reintroduce the toggle.

### Fixed

- **Preflight no longer falsely demands API keys Karajan doesn't use** (PR #466). Pre-v2.7.4, the preflight failed with "`ANTHROPIC_API_KEY not set`" / "`OPENAI_API_KEY not set`" — blocking every Claude Code MCP run where the parent uses OAuth (`apiKeySource: "none"`) — even though Karajan never calls provider APIs directly. Verified: zero SDK imports in `package.json`, zero `process.env.ANTHROPIC_API_KEY` reads in `src/agents/`. The check was pure dead weight from an earlier design. Now replaced with a **CLI availability** check (`cli:anthropic` → `checkBinary("claude")`, `cli:openai` → `codex`, etc.) that mirrors what Karajan actually does at runtime. The `token:gh` check stays — that one's legitimate (`git push` uses `GH_TOKEN`).
- **Orchestrator no longer crashes with `Cannot read properties of undefined (reading 'push')`** on the preflight-failure Solomon escalation path (PR #466). `addCheckpoint()` now defensively initialises `session.checkpoints = []` if missing; the init-error catch builds `tempSession` with `checkpoints: []` explicitly. Two-layer fix so the whole class of bug is gone, not just this one call site.

### Added

- **Architectural regression guards** (PR #466 + PR #468). Two new test files under `tests/architecture/` that fail CI on any future change that:
  - **`no-provider-apis.test.js`** — adds a provider SDK to `dependencies`/`devDependencies`, imports one from `src/`, reads a provider API key env var outside the preflight allowlist, or reintroduces a `token:<provider>` check (must be `cli:<provider>`, except the legitimate `token:gh`).
  - **`sonar-intrinsic.test.js`** — ANDs the preflight gate with `config.sonarqube?.enabled`, gates `runSonarStage` on the config instead of `resolved_policies.sonar`, makes `--no-sonar` mutate the config, or changes the policy so code task types don't require Sonar.

  Both files document the architectural rule and the "read-this-before-disabling" rationale in their JSDoc.

- **Self-explanatory "Not applicable" preflight messages** (PR #467). Check `applies(config)` can now return `{ applies: false, reason: "..." }` so users see *why* a check was skipped instead of a generic "Not applicable for current configuration". Wired into `createSonarPortCheck` and `createHuBoardPortCheck` for explicit skip reasons (external sonar, hu_board disabled).

- **`docs/TESTS.md`** (PR #467). New ~280-line test-suite guide: how to run / debug, directory map, ASCII pipeline-coverage diagram, per-directory explanation of what is tested and why, list of architectural invariants with "don't disable without a discussion" rationale, known coverage gaps, contribution checklist.

### Infrastructure

- Test harness gets a new `globalThis.__KJ_DISABLE_SONAR_STAGE` flag (default `true` under Vitest, set in `tests/setup.js`). Tests that legitimately exercise the sonar stage opt in per-describe or per-test. Same pattern as the existing `__KJ_DEFAULT_PREFLIGHT_EXTENDED`, `__KJ_DEFAULT_BRAIN_DECISOR`, `__KJ_DEFAULT_ADDYOSMANI_ENABLED`.
- Test count: 3 720 passing across 289 files. Lint clean on Node 18/20/22.

## [2.7.3] - 2026-04-23

### Added

- **`--task-file` / `taskFile` — read the task from a `.md` file** (PR #464). For anything beyond a one-liner, writing `kj run "very long multi-paragraph prompt..."` was painful. Every task-taking CLI command (`run`, `code`, `review`, `plan`, `discover`, `triage`, `researcher`, `architect`, `audit`) now accepts `--task-file <path>` and every matching MCP tool schema (`kj_run`, `kj_code`, `kj_review`, `kj_plan`, `kj_discover`, `kj_triage`, `kj_researcher`, `kj_architect`, `kj_audit`) accepts a `taskFile` argument. Precedence rule (same across CLI + MCP): positional `task` wins over `taskFile` when both are given, with a warning. Relative paths resolve against `projectDir` (or `cwd`). 256 KiB size cap. The positional `<task>` arg on every CLI command is now `[task]` (optional). New helper `src/utils/task-file.js` centralises parsing + precedence.

- **CLI `kj <cmd>` now writes `.kj/run.log` like MCP does** (PR #463). Previously only MCP handlers (`kj_run`, `kj_audit`, …) created the run log, so `kj-tail` was silent when Claude Code invoked `kj` via the Bash tool. New helper `src/utils/cli-run-log.js::withCliRunLog()` is wired into `run`, `audit`, `code`, `review`, `plan`, `discover`, `triage`, `researcher`, `architect`. Writes `[kj_<cmd>] started (cli)` / `finished — ok=<bool>` / `failed — <error>` markers plus per-event forwarding when the command has an EventEmitter (e.g. `kj run` mirrors every progress event into run.log alongside its existing activity-log path).

- **`kj-tail` v1.38.0 waits for the log to appear instead of exiting** (PR #464). Before: `kj-tail` hard-exited if `.kj/run.log` didn't exist yet, so users had to race the command and missed early lines. Now: prints a yellow notice listing which commands trigger the log, ensures `.kj/` exists, polls every 500 ms, and streams as soon as the log appears. Snapshot mode (`-s`) stays non-blocking. 4-hour safety cap avoids zombie panes.

### Fixed

- **Node 18 LTS users can now actually run `kj`** (PR #463). `package.json` had claimed `"engines": { "node": ">=18.0.0" }` for ages, but `src/checks/node.js` required Node 20 and failed at preflight with a misleading "needs structuredClone / findLast / AbortSignal.timeout / fetch" message. All four are Node 18 features. `MIN_NODE_MAJOR` lowered from 20 to 18. CI lint matrix gains `18.x` alongside `20.x` / `22.x` to catch any regression that would break Node 18 users. (Test matrix stays on 20+ because vitest 4 / rolldown — devDependencies only, never shipped to users — require `styleText` which is Node 20.12+.)

### Infrastructure

- Removed 8 stale merged local branches + 2 abandoned git worktrees under `.kj/worktrees/`.
- 22 new vitest cases across `tests/utils/task-file.test.js` and `tests/utils/cli-run-log.test.js`. Total suite: 3 702 tests across 287 files.

## [2.7.2] - 2026-04-23

### Added

- **Skills observability** (PR #461, follow-up to KJC-TSK-0327). Two improvements so the user can see which skills Karajan actually used per run:
  - `summary.md` gains a new **"Skills Used"** section listing the addyosmani/agent-skills action (`cloned` / `pulled` / `fresh` / `unavailable`) and the role/task-resolved slugs that were injected into role prompts, the OpenSkills actually installed this run, and OpenSkills recommended (would-have-used) when the CLI is missing. Section is elided when no skill activity happened. Data flows from `flow-runner.js` → `summary-writer.js` via a new `skills: { addyosmani, installed, recommended }` field on `SummaryInput`. Seven new vitest cases cover every combination + elision.
  - `kj-tail` **v1.37.0** gains a 🎯 filter for `[skills:*]` events — magenta for success (`ready` / `auto-install`), yellow for graceful-degradation paths (`unavailable` / `would have used`). Previously these lines fell through to the default styling without an icon, so skill decisions were hard to spot in the live tail.

## [2.7.1] - 2026-04-23

### Fixed

- **SEA binary release workflow has been broken since v2.4.1** (PR #459). Five releases (v2.4.1, v2.5.0, v2.6.0, v2.6.1, v2.7.0) shipped with empty GitHub Release assets because `scripts/build-sea.mjs` calls `await import("esbuild")` — an ESM dynamic import that resolves from local `node_modules`, not from globally-installed packages — while the workflow installed esbuild with `npm install -g`. Every tag push failed silently at "Build SEA binary" with `Cannot find package 'esbuild' imported from scripts/build-sea.mjs`. Fix: `esbuild` (`^0.28.0`) and `postject` (`^1.0.0-alpha.6`) are now declared as `devDependencies`; a single `npm ci` in the workflow pulls them into `node_modules` where the dynamic import can resolve them. Verified locally — `node scripts/build-sea.mjs` produces a working 119 MB `dist/kj` that reports `--version 2.7.1`. v2.7.1 is the first release since v2.4.0 to actually ship the `linux-x64` / `darwin-arm64` / `win-x64` binaries plus their SHA256 checksums.

## [2.7.0] - 2026-04-22

### Added

- **addyosmani/agent-skills as first-source process catalog** (KJC-TSK-0327, PR #456). Karajan now consults the [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills) repository **before** OpenSkills when resolving which skills to inject into role prompts. The two providers cover orthogonal axes: addyosmani brings lifecycle/process workflows (TDD, code-review, security, performance, git-workflow, CI/CD, debugging, docs, spec-driven, planning...) mapped per Karajan role, while OpenSkills keeps providing stack-specific skills (astro, react, prisma, vitest-patterns...). On first use, the catalog is shallow-cloned into `~/.karajan/agent-skills/`; subsequent runs refresh via `git pull` after `skills.addyosmani.refreshDays` (default 7 days). When git is absent or the network is unreachable, the step degrades silently and the pipeline continues unblocked.
- **Role → addyosmani-slug mapping** — `src/skills/addyosmani-role-map.js` wires each Karajan role to its canonical workflows: `tester → test-driven-development + browser-testing-with-devtools`, `reviewer → code-review-and-quality + code-simplification`, `security → security-and-hardening`, `architect → spec-driven-development + api-and-interface-design + planning-and-task-breakdown`, `coder → incremental-implementation + source-driven-development + context-engineering + debugging-and-error-recovery`, and more. Task-text triggers add slugs on top (e.g. tasks mentioning "performance" or "Core Web Vitals" pull `performance-optimization`).
- **New config subtree** `skills.sources` (default `["addyosmani", "openskills", "local"]`) and `skills.addyosmani.{enabled,refreshDays,repoUrl}` validated by the Valibot schema.
- **New CLI subcommands**: `kj skills sync-addyosmani` forces a `git pull` of the catalog, `kj skills list-addyosmani` enumerates cached slugs with their descriptions.

### Infrastructure

- `tests/setup.js` defaults `__KJ_DEFAULT_ADDYOSMANI_ENABLED = false` under Vitest so orchestrator event-sequence tests don't spawn git probes. Tests that exercise the real catalog opt in per-case.
- 35 new test cases across `tests/skills/addyosmani-catalog.test.js` (25) and `tests/skills/addyosmani-role-map.test.js` (10) covering frontmatter parsing, clone/pull lifecycle, TTL, path-traversal guards and graceful degradation.

## [2.6.1] - 2026-04-20

### Fixed

- **hu-board: session.json without a matching auto-batch is no longer dropped** (KJC-BUG-0028). Previously `syncSessionFile` bailed with `if (!projectId) return;` when a session had no batch and no `project_id`, and it never called `upsertProject` even when `project_id` was present. Result: running `kj run "task"` without HU decomposition produced a session that was invisible on the board. Now `syncSessionFile` upserts the project row in that order: `auto-<sessionId>` → `data.project_id` → `default` (bucket `"Orphan sessions"`). Restores the two regressed tests in `packages/hu-board/tests/sync.test.js`.
- **hu-board: `fullScan` plans directory is now isolated for tests**. The scan of v2 plans previously hardcoded `~/.kj/plans/` via `homedir()`, so running the test suite flooded the output with entries from the developer's real machine. `KJ_PLANS_DIR` now overrides that path; the hu-board vitest config sets it to a non-existent placeholder so tests never read real plans.

### Infrastructure

- `packages/hu-board/vitest.config.js` sets `env.KJ_PLANS_DIR` for all test runs.

## [2.6.0] - 2026-04-19

### Added

- **Infrastructure Dependency Injection** (KJC-TSK-0316, PR #444) — `src/infrastructure/` introduces `FileSystemService`, `CommandRunner`, and an `Environment` bundle so tests can inject `MockFileSystem` / `MockCommandRunner` instead of spawning real subprocesses. `BaseAgent` now accepts an optional `Environment`; all 5 concrete agents (Claude, Codex, Gemini, Aider, OpenCode) route execution through the injected runner. Closes #364.
- **StageExecutor contract** (KJC-TSK-0315, PR #445) — `src/orchestrator/stages/stage-executor.js` defines the `StageExecutor` base class (`canRun` / `execute` / `onFailure`) + `StageRegistry` + `runStage()`. The orchestrator can iterate a stage registry instead of branching on `pipelineFlags` for every new feature. Closes #361.
- **Valibot config validation** (KJC-TSK-0318, PR #446) — `src/config/schema.js` validates merged YAML on load, catching `review_mode` typos, `max_iterations: 0`, non-integer iterations, invalid methodology, out-of-range `hu_board.port`, `budget.warn_threshold_pct` outside 0-100, and negative `max_budget_usd`. `KarajanConfig` @typedef exported via `v.InferOutput`. Builds on Jorge del Casar's closed PR #379 (co-authored). Closes #363, #367.
- **JSDoc typedef registry** (KJC-TSK-0317, PR #443) — central JSDoc typedefs for core entities (`KarajanConfig`, `Session`, `Stage`, `Agent`, `Hu`, `Policy`) under `src/types/`. Opt-in `tsc --noEmit` typecheck via `npm run typecheck` scoped to consumers using the new typedefs.
- **Budget comparison** (KJC-TSK-0274, PR #442) — session budget now shows "With KJ: $X / N tokens · Without KJ: ~$Y / ~M tokens (-Z%)" so you can see token savings from RTK + Brain compression at a glance.
- **Rich session journal** (PRs #439–#441) — `.reviews/<session>/decisions.md`, `iterations.md`, `summary.md`, `tree.txt` give an executive view of each run: stages table, budget breakdown, directory-grouped file status, per-iteration coder/reviewer/sonar/Solomon detail.

### Changed

- **`src/orchestrator.js` is now a 22-line barrel** (KJC-TSK-0315). The full 2 084-line monolith moved to `src/orchestrator/flow-runner.js`. Public API (`runFlow`, `resumeFlow`, `loadProductContext`, `shouldAutoContinueCheckpoint`, `parseCheckpointAnswer`) is re-exported so existing imports keep working.
- **HU Board auto-start gate simplified** (KJC-TSK-0273, PR #448) — `tryAutoStartBoard` now gates on `hu_board.auto_start` alone (no more double-gate on `enabled` + `auto_start`). Both call sites (init + post-planner auto-HU) share the new `renderBoardBanner()` helper and emit the same prominent cyan URL box. Skipped cleanly under `VITEST` / `NODE_ENV=test` to prevent detached server leaks.
- **Test audit + opt-in helper** (KJC-TSK-0307, PR #447) — 21 opt-in feature test files (brain, ci, sonar, hu-board, webperf) labelled `[opt-in: <feature>]`. New `tests/support/opt-in.js` helper + `KJ_SKIP_OPTIN_<FEATURE>=1` / `KJ_SKIP_ALL_OPTIN=1` escape hatches for fast feedback loops.

### Fixed

- **Falsy CLI overrides honored** (KJC-TSK-0318) — `--no-rebase` correctly sets `git.auto_rebase = false`, `--reviewer-retries 0` correctly sets `reviewer_options.retries = 0`, `--max-iterations 0` errors clearly instead of falling through to the default.

### Infrastructure

- Logo updated: README now uses the orbit logo shared with the landing page.
- Full suite: **3 638 tests / 283 files** (+48 new in this release).

## [2.5.0] - 2026-04-07

### Added

- **Mini Planning Game module** (KJC-PCS-0038) — independent planning system with two-phase workflow: plan first, then execute.
  - `kj plan "task"` — generates v2 plan with HUs (globally unique IDs, acceptance tests, task_type classification)
  - `kj plan list/show/validate/delete` — plan management
  - `kj plan ready <id>` — certify all HUs, mark plan as ready
  - `kj plan add-hu/remove-hu` — manual HU CRUD
  - `kj run --plan <id>` — executes plan's HUs via sub-pipeline with acceptance tests
  - Plan file updated in real-time as HUs execute (status: running → done/failed)
  - HU Board syncs from `~/.kj/plans/` — shows plans as projects with HU status
  - v2 schema with lazy v1→v2 migration, cycle detection in dependency graph

## [2.4.1] - 2026-04-07

### Fixed

- **Sonar quality gate runs for sw HUs** — acceptance_tests bypassed the entire standard pipeline including sonar. Now sonar runs between coder and acceptance_tests when `huPolicies.sonar === true`. If sonar fails, feedback goes to coder for next attempt.
- **HU Board shows rich data** — sync now extracts title, scope (certified.text), and acceptance_criteria from auto-generated HUs. Story detail modal shows "Scope" section with full text. Cards show real titles instead of "HU-01".
- **vitest updated** — 0 npm vulnerabilities (vite path traversal patched).

## [2.4.0] - 2026-04-07

### Added

- **Executable acceptance tests for HUs** — each HU now has `acceptance_tests`: an array of shell commands that Brain executes after each coder iteration. All pass → HU approved. Any fail → Brain reads the exact error output and sends a concrete diagnostic to the coder ("install @vitest/coverage-v8", not "Coverage: not measured"). No reviewer. No generic tester. Concrete pass/fail.

### Fixed

- **Security audit fixes** — command injection in `git add` (HIGH: `execSync` → `execFileSync`), allowlist bypass in `isCommandAllowed` (MEDIUM: `startsWith` → exact token match), credentials file permissions (MEDIUM: `0o644` → `0o600`), token masking in MCP responses (LOW).

### Changed

- Setup HU now explicitly includes coverage reporter installation in its scope and acceptance_tests.
- HU sub-pipeline: when `acceptance_tests` are defined, Brain runs a custom loop (coder → acceptance_tests → diagnose → retry) instead of the standard reviewer/tester pipeline.

## [2.3.2] - 2026-04-06

### Fixed

- **Per-HU policy application** — each HU's `task_type` now drives which pipeline stages run. `infra` HUs skip reviewer, sonar, TDD, and tester (only coder + impeccable). `sw` HUs get the full pipeline. Policies saved/restored per HU.
- **infra policy: reviewer disabled** — setup/scaffolding HUs don't need code review. They just need `npm install` + `npm test` to not crash.
- **Stack hint filtering** — when Node.js keywords are present (express, vite, vitest), Go keywords (gin, fiber) are removed. Prevents coder from creating a Go module in a Node.js project.
- **HU Board duplicate projects eliminated** — sessions never create projects. Only batches in `hu-stories/` are authoritative. Non-auto batches skipped if an auto- version already covers the session.

## [2.3.1] - 2026-04-06

### Fixed

- **"default" project removed from HU Board** — sessions without `project_id` now use `sessionId` and derive a readable name from `session.task` via `slugToTitle`. No more phantom "default" project with 0 stories.
- **Sync button (🔄) in HU Board header** — triggers `POST /api/sync` to re-scan disk for new batches without restarting the board. Shows ⏳ while scanning.

## [2.3.0] - 2026-04-06

### Fixed

- **Complete Brain audit — 21 v1 legacy violations fixed.** Exhaustive audit of all orchestrator stages found 21 places where Solomon was invoked directly (bypassing Brain), `session.task` leaked into per-HU context (causing reviewer to evaluate setup HUs against the full task spec), or feedback mutations skipped Brain's queue. All fixed:
  - `sonar-stage.js`: `brainCtx` parameter added, Solomon calls gated, sonar feedback pushed to Brain queue, `session.task` → task parameter
  - `coder-stage.js`: TDD handler Solomon gated, TDD failure pushed to Brain queue, user guidance pushed to queue
  - `reviewer-stage.js`: ALL reviewer rejections (including style-only) routed through Brain, `solomon:evaluate` → `brain:evaluate` when Brain active
  - `post-loop-stages.js`: security stage Solomon gated, security failure pushed to Brain queue
  - `solomon-escalation.js`: removed `|| session.task` fallback — `conflict.task` is now required
  - `orchestrator.js`: `brainCtx` threaded to `runQualityGateStages`, `runTddCheckStage`, `runSonarStage`, `runSecurityStage`; `runSingleIteration` uses `ctx.plannedTask || ctx.task` so per-HU reviewer evaluates the HU scope, not the full spec
- **HU Board `/api/sync` endpoint** — `POST /api/sync` triggers `fullScan()` to re-read all batch.json and session.json from disk. Frontend auto-syncs on page load and every 10s refresh. Fixes chokidar watcher not detecting new batches created after board start.
- **Model registry update** (Jorge del Casar #412) — Claude 4.6, GPT-5.4, Gemini 3.1, DeepSeek V4/R1, MiniMax M2.x. `registerModelAlias()` for CLI prefixes. Smart pricing fallback (exact → provider/model → prefix-strip).

## [2.2.1] - 2026-04-06

### Fixed

- **Setup HU no longer includes the full task description** — the HU-01 certified text was embedding the entire original prompt (2000+ chars), causing the coder to attempt implementing everything and the reviewer to reject because security middleware was "missing". Now the setup HU says explicitly: "DO NOT implement any business logic. This HU is ONLY project scaffolding."
- **Task HUs are truly minimal** — each HU references only the short project name (not the full prompt), includes "target <200 lines changed (like an atomic PR)", and directs the coder to not touch files outside the subtask's scope.
- **Legacy batch names in HU Board** — `sync.js` now derives project_name from "Part of: <originalTask>" embedded in story text for batches created before v2.2.0. Cryptic `s_2026-04-05T...` names become readable in the Board selector.
- **Extended stopwords** for project name derivation — added "this", "is", "it", "full", "full-stack", "stack", "based", etc. Fixes names like "Real-time Collaborative Task Board This Is".
- **Delete button moved to per-card** — 🗑️ appears top-right of each project card on hover (replaces less practical header button).

## [2.2.0] - 2026-04-06

### Added

- **HU Board UX overhaul** (KJC-PCS-0037):
  - **Human-readable `project_name`** — auto-generated HU batches derive a readable name from the task prompt (strips action verbs + stopwords, title-cases first 6 meaningful words). The Board selector now shows "Real-time Collaborative Task Board" instead of cryptic `auto-s_2026-04-05T...` IDs. `project_id` remains unique per run (includes timestamp) so repeated runs of the same prompt are distinguishable.
  - **DELETE endpoints + UI button** — `DELETE /api/projects/:id` (cascade: project + stories + sessions + removes `~/.karajan/hu-stories/<id>/` from disk), `DELETE /api/stories/:id`, `DELETE /api/sessions/:id`. Frontend shows a 🗑️ button next to the project selector when a specific project is chosen, with confirmation dialog.
  - **Port fallback** — when port 4000 is busy, `startBoard()` now tests availability via transient TCP bind and falls back to 4001, 4002... up to 4009. No more silent crashes on port collision.
  - **Auto-start on auto-HU** — when auto-generator produces a batch, the board starts automatically independent of `hu_board.auto_start`.
  - **Highlighted URL banner** — after auto-start, a cyan boxed banner with URL + project name is printed so users cannot miss it.

### Fixed

- `.kj/` worktrees excluded from vitest runs (stale worktree tests were polluting results).

## [2.1.1] - 2026-04-05

### Fixed

- **Auto-HU batch persistence path**: auto-generator wrote `batch.json` to `~/.karajan/hu/<sid>/` but the HU store reads from `~/.karajan/hu-stories/<sid>/`. Caused ENOENT crash when `runHuSubPipeline` tried to load the auto-generated batch. Fixed by using the correct `hu-stories/` directory.

## [2.1.0] - 2026-04-05

### Added

- **Auto-HU Decomposition** (KJC-PCS-0035): when a task is complex and triage recommends decomposition, Karajan now automatically generates a certified HU batch and runs each HU as an independent sub-pipeline with its own atomic git branch/PR. No more 50-file blob tasks.
  - **HU auto-generator** (`src/hu/auto-generator.js`): converts triage subtasks into an HU batch with automatic setup HU when the project is new or has stack hints. Classifies each HU into a `task_type` (infra/sw/add-tests/doc/refactor/nocode) so downstream policy gates apply correctly per HU.
  - **Wiring**: after triage + researcher + architect + planner, if triage recommended decomposition and no manual `--hu-file` was passed, the batch is persisted to `.karajan/hu/auto-<sid>/batch.json` and injected as `stageResults.huReviewer`. The existing `needsSubPipeline` / `runHuSubPipeline` infrastructure picks it up.
  - **Per-HU max_iterations**: each HU gets a focused iteration budget (default 3, configurable via `config.hu_max_iterations`) and a fresh Brain state (feedback queue, verification tracker, extension count reset to 0) so issues from one HU never bleed into the next.
  - **Per-HU git automation** (`src/git/hu-automation.js`): each HU gets its own branch (`feat/HU-<id>-<slug>`) chained from its parent HU's branch (or `base_branch` for root HUs). On approval: commits atomically with `feat(HU-<id>): <title>`, optionally pushes and opens a PR (gated by existing `git.auto_commit`/`auto_push`/`auto_pr` flags).

### Fixed

- `emitAgentOutput` helper unified across all stages (coder, reviewer, refactorer, architect, planner, researcher, triage).

## [2.0.2] - 2026-04-05

### Added

- **Brain compression + feedback queue across all stages** (not just reviewer). Researcher, architect, planner outputs are compressed; tester and security failures enter the typed feedback queue with enrichment for the next coder iteration.
- **Brain owns max_iterations decision.** Brain inspects its feedback queue state at max_iterations: security entries → pause for human, correctness/tests → extend iterations, empty queue → finalize, style-only → consult Solomon as advisor. Solomon is never invoked directly from max_iterations anymore.
- **Agent action lines in quiet mode.** `kj run` now interprets Claude's stream-json tool_use blocks into concise action lines (`Read packages/server/index.js`, `Bash $ npm install express`, etc.), so users can see what the coder is doing without enabling verbose mode.
- **Heartbeat visible in quiet mode.** `agent:heartbeat` events (every 30s) are no longer suppressed, so `kj run` shows a status line (`⏳ claude working — 45s elapsed`) instead of looking hung during long agent calls.
- **ASCII banner printed on `kj run`** regardless of TTY detection (was silently skipped in many environments).

### Fixed

- **`kj run` no longer looks hung.** Combined with heartbeat + action lines, long-running agents show clear progress.

### Changed

- **`solomon:alert` event renamed to `brain:rules-alert`** (display: "⚠️ Rules alert" instead of "⚖️ Solomon alert"). The rules engine emits telemetry; it is not an invocation of Solomon.
- All stage `onOutput` handlers now go through the unified `emitAgentOutput` helper, routing `kind=tool` to `agent:action` (visible in quiet mode) and everything else to `agent:output` (verbose only).

## [2.0.1] - 2026-04-05

### Fixed

- **Brain actually wired to pipeline**. v2.0.0 shipped Brain modules but nothing imported them — the pipeline still ran v1 Solomon-as-boss logic. This release wires Brain into the actual execution path.
  - `brainCtx` created at session init, threaded through coder and reviewer stages
  - Coder stage uses enriched feedback prompts from Brain's typed queue
  - Coder stage calls `verifyCoderRan` after each run; stalls after N consecutive 0-change iterations
  - Reviewer stage: on correctness/tests/security rejections, Brain bypasses Solomon and pushes issues to feedback queue (Solomon only consulted on style-only dilemmas)
- **Brain owns human escalation** — `solomon-rules` no longer prompts user directly. When Brain is enabled, rule alerts route through Brain → Solomon AI judge → human (only if neither resolves).
- **Brain actively consults Solomon** on critical dilemmas (stale iterations, new deps) and applies Solomon's decision (approve/continue/pause).
- **Stale detection data** — reviewer checkpoints now record a feedback signature, coder checkpoints record `filesChanged`. Previously both were empty/zero, making solomon-rules falsely detect "stale" after 3 iterations with different bugs.
- **HU Board auto-start crash on nvm/macOS** (reported by Jorge del Casar). `spawn("node", ...)` failed with ENOENT because detached subprocess didn't inherit node's PATH. Fixed by using `process.execPath`. Added error handler to prevent unhandled `error` event from crashing parent process.

### Changed

- **Brain enabled by default** (`brain.enabled: true`). v2 is Brain architecture; users who explicitly don't want Brain can set `brain.enabled: false`, but the canonical v2 experience is Brain-on.

## [2.0.0] - 2026-04-04

Major release. See [MIGRATION-v2.md](./MIGRATION-v2.md) for upgrade guide.

### Breaking Changes

- **Proxy subsystem removed** — the HTTP proxy did not work with SSE streaming (Claude) or WebSockets (Codex). Use RTK (auto-detected) for token savings. Removed: `src/proxy/`, `config.proxy.*` keys, `--proxy` / `--no-proxy` / `--proxy-port` flags, `enableProxy` MCP arg.
- **`becaria` → `ci` rename** — the CI/CD integration renamed from "BecarIA" to "ci" (BecarIA is a Planning Game developer ID, not a Karajan concept). Breaking: `config.becaria` → `config.ci`, `--enable-becaria` → `--enable-ci`, `session.becaria_pr_number` → `session.ci_pr_number`, default events `becaria-review`/`becaria-comment` → `kj-review`/`kj-comment`, GitHub secrets `BECARIA_APP_ID`/`BECARIA_APP_PRIVATE_KEY` → `KJ_CI_APP_ID`/`KJ_CI_PRIVATE_KEY`, workflow `becaria-gateway.yml` → `kj-ci-gateway.yml`.
- **Tester and Security are blocking gates** — previously advisory (auto-continued if reviewer approved). Now their failures send feedback back to coder for fixing, like reviewer rejections.
- **Solomon no longer overrides security issues** — deterministic guard: when reviewer reports security-category issues, they always go back to coder. Solomon is bypassed for security.
- **Scope guard `max_files_per_iteration` removed** — the 10-file limit was wrong for greenfield projects. Coder prompt now enforces atomic commits instead.
- **Dead config keys removed** — `retry.*`, multiple dead `proxy.*` sub-keys eliminated from DEFAULTS.

### Added — Karajan Brain Architecture (Epic KJC-PCS-0034)

New AI-powered orchestration layer (opt-in via `brain.enabled: true`). Separates concerns between Karajan Brain (CEO/orchestrator) and Solomon (advisor/judge).

- **Karajan Brain Role** (`src/roles/karajan-brain-role.js`) — central orchestrator that decides routing, enriches prompts, suggests direct actions
- **Brain Skills** (`templates/roles/karajan-brain.md`) — 7 skills: route-decision, prompt-enrichment, output-verification, direct-action, rtk-compression, stack-detection, dependency-management
- **Solomon refined as AI Judge** — consulted only on genuine dilemmas (security-vs-deadline, conflicting gates, stalled loops, risk evaluation)
- **Structured feedback queue** (`src/orchestrator/feedback-queue.js`) — typed message queue replaces flat `last_reviewer_feedback` string
- **Feedback enrichment** (`src/orchestrator/feedback-enrichment.js`) — transforms vague feedback into actionable file paths + numbered action plans
- **Verification gate** (`src/orchestrator/verification-gate.js`) — detects 0-change coder iterations, tracks stuck loops
- **Direct actions** (`src/orchestrator/direct-actions.js`) — allow-listed commands (npm install, create_file, update_gitignore, git_add) with path traversal guards
- **Role output compressor** (`src/orchestrator/role-output-compressor.js`) — per-role strategies for 40-70% token savings between roles
- **Brain coordinator** (`src/orchestrator/brain-coordinator.js`) — ties all modules together

### Added — Reliability Improvements

- **Smart init** — `kj run` auto-detects installed AI CLIs and assigns them to roles by capability (claude=5, codex=4, gemini=3). Diversifies reviewer from coder, Solomon from Brain.
- **Auto-init** — creates git repo, `.gitignore`, `.karajan/` scaffolding automatically when missing
- **Stack-aware .gitignore** — after planner detects language, adds stack-specific entries (node_modules/, __pycache__/, target/, etc.)
- **Diff scoping to projectDir** — prevents reviewer from seeing unrelated branch changes when running from a subdirectory
- **Session journal** — persists pipeline state to `.reviews/session_*/` with stage outputs, iterations log, decisions, tree, summary
- **Chrome DevTools MCP auto-detection** from `~/.claude.json`
- **AgentRole base class** — eliminates boilerplate across 13 LLM-backed roles

### Removed

- Proxy subsystem (see Breaking Changes)
- 15 dead exports across src/
- 9 deterministic compressor files (consolidated into 2 registries)

### Fixed

- Tester now executes real test commands with coverage (vitest/jest/pytest/etc.) instead of LLM-guessing
- RTK display explains 0% savings (previously looked broken)
- Logger uses local time instead of UTC
- Scope guard respects projectDir (files inside projectDir always in scope)
- `categorizeIssues` precision: "auth route test" no longer classified as security

### Internal

- AgentRole base class extracts common LLM-role boilerplate (~1200 LOC reduction)
- Orchestrator extracted into config-init, becaria-integration, flow-control modules
- Deterministic compressors consolidated (11 files → 4)
- Session journal integrated into pipeline

## [1.58.2] - 2026-04-01

### Fixed
- **Test fix**: buildAskQuestion test updated for capabilities detection (#316)
- **Branch protection**: enforce PRs for all pushes to main (including admins)

## [1.58.1] - 2026-04-01

### Added
- **CLI welcome screen**: running `kj` with no arguments shows a branded welcome with version, configured agents, and quick start commands. Uses Commander's `program.action()` so `kj --help` still works normally (#312, by @reiaguilera)

## [1.58.0] - 2026-04-01

### Added
- **Domain Knowledge System**: new `domain-curator` role discovers, proposes and synthesizes business-domain knowledge from `~/.karajan/domains/` (user/company bank) and `.karajan/domains/` (project overrides). Domain context is injected into all downstream roles (Researcher, Architect, Planner, Coder, Reviewer, HU-Reviewer) as a `## Domain Context` section (#315)
- **Domain Loader**: parses `DOMAIN.md` files with YAML frontmatter (name, description, tags, version, author, visibility) and markdown sections (Core Concepts, Terminology, Business Rules, Common Edge Cases). Cascading resolution: project-local overrides user-global by directory name
- **Domain Registry**: local JSON index at `~/.karajan/domain-registry.json` with search by tags, name and description. Interface prepared for future remote registries
- **Domain Synthesizer**: filters relevant domain sections by keyword overlap with task + hints, compacts output to token budget (default 4000 tokens)
- **Enhanced askQuestion**: detects host MCP capabilities (`server.getClientCapabilities()?.elicitation`) and adapts behavior — `askQuestion.interactive` boolean, structured question types (multi-select, select, confirm, text), free-text response parser, default policies per stage
- **Triage domainHints**: triage now detects business-domain keywords and outputs `domainHints[]` for the Domain Curator to search domains
- **Skill-loader type discrimination**: `SKILL.md` files with `type: domain` frontmatter are loaded by the Domain Curator (injected globally) while `type: technical` (default) skills remain coder-only
- **Pipeline**: 15 → 16 roles. Domain Curator slots after triage + skill auto-install and before researcher/architect/planner
- 102 new tests across 8 test files

## [1.57.2] - 2026-04-01

### Added
- **`kj init` gitignore entries**: auto-appends `.kj/`, `.agent/`, `.scannerwork/` to project `.gitignore` if missing (#310)

### Fixed
- **Model/provider resolution**: when model is `gemini/pro`, infer provider=gemini and strip prefix. Drop incompatible explicit models (#305)
- **SonarQube auto-start**: wait up to 60s after `docker compose up` instead of checking once immediately. Fixes false "auto-start failed" on cold boot (#306)
- **Subprocess stdin hangs**: all subprocesses now run with `stdin: "ignore"`. Prevents indefinite hangs when sonar, agents, or npm prompt for input (#307)
- **CI**: removed deprecated macOS Intel runner (macos-13) from release workflow (#304)
- **.gitignore**: added `.claude/`, `.scannerwork/`, `.agent/`, `dist/`, `.kj/` (#308, #310)

## [1.57.1] - 2026-03-31

### Added
- **SEA binary build**: standalone binary via `node scripts/build-sea.mjs`. No Node.js required to run
- **Release workflow**: GitHub Actions builds binaries for linux-x64, darwin-arm64, darwin-x64, win-x64 with SHA256 checksums on every tag

### Fixed
- **YAML duplicate keys**: config loader now tolerates duplicated keys in user config files (#300)

## [1.57.0] - 2026-03-31

### Added
- **Telemetry (opt-out)**: anonymous usage statistics (version, OS, command, pipeline duration, success rate). No code or personal data. Opt out with `telemetry: false` in config (#295)
- **MCP graceful restart**: after `npm update`, the MCP server writes a restart marker file and exits with a 2-second grace period. The new instance detects the marker and logs reconnection context (#294)
- 25 new tests (telemetry, MCP reconnect, resume config snapshot)

### Fixed
- **Resume respects session flags**: `kj_resume` now uses the session's saved config snapshot instead of loading a fresh config. Flags like `--no-sonar` from the original run are preserved (#297)
- **Circular ESM imports (TDZ)**: extracted shared helpers from server-handlers.js into separate modules, breaking the circular dependency chain that caused 30 test failures (#296)

## [1.56.0] - 2026-03-31

### Added
- **`kj status` dashboard**: terminal view showing HU states (pending/coding/reviewing/done/failed), current stage, timing, and progress. MCP returns structured JSON (#292)
- **`kj init` auto-detect stack**: scans package.json/go.mod/Cargo.toml/etc., detects frameworks (React, Express, Astro, Go, Rust...), auto-enables impeccable for frontend, suggests skills (#290)
- **HU Board authentication**: optional Bearer token auth via `HU_BOARD_TOKEN` env var. API endpoints protected, static assets public. Backward compatible (#291)
- 39 new tests

## [1.55.0] - 2026-03-31

### Added
- **`kj undo`**: revert last pipeline run with `kj undo` (soft reset) or `kj undo --hard`. 24th MCP tool (#288)
- **Documentation links in errors**: all error messages include a "See:" link to the relevant doc page (#287)

### Fixed
- **0 test failures**: fixed 2 pre-existing stale assertions in pg-decomposition and checkpoint-ui tests (#286)

## [1.54.0] - 2026-03-31

### Added
- **`--design` flag**: activates impeccable role in refactoring mode. Coder applies design changes (hierarchy, spacing, responsive, a11y, animations, theming) instead of just auditing. New `impeccable-design.md` template. Works from CLI and MCP (#284)
- 11 new tests

## [1.53.1] - 2026-03-31

### Changed
- **MCP response compressor**: all tool responses are now compressed before sending to host AI. Strips verbose fields from lists, truncates arrays (20 items), commits (last 5), findings (first 10). Compact JSON without indentation. Vital fields preserved (#281)

## [1.53.0] - 2026-03-31

### Added
- **Plan → Run connection**: `kj_plan` now runs researcher + architect before planner and persists the result. `kj_run --plan <planId>` loads the persisted plan context and skips pre-loop stages. Plans stored in `~/.kj/plans/` (#279)
- Plan store: savePlan, loadPlan, listPlans, getLatestPlan
- CLI: `kj run --plan <planId>`
- 10 new tests

## [1.52.0] - 2026-03-31

### Added
- **No-code pipeline mode**: triage detects non-coding tasks (data analysis, SQL queries, CSV transforms, reports) and disables TDD + SonarQube automatically. Coder generates output, reviewer validates logic (#277)
- **3 no-code skills**: `kj-sql-analysis` (query generation + injection checks), `kj-csv-transform` (delimiter detection, encoding, validation), `kj-data-report` (structured reports with methodology) (#276)
- Skill detector patterns for SQL, CSV, and report tasks
- 26 new tests

## [1.51.0] - 2026-03-30

### Added
- **RTK real integration** (epic KJC-PCS-0028): auto-install during kj init, enforce RTK wrapping in all internal Bash commands (git, diff, ls), measure and report token savings per session (#270, #271, #272)
- **RTK savings in reports**: session end shows estimated tokens saved, compression ratio, command count. `kj report --trace` includes RTK stats

### Fixed
- **Audit/analysis tasks skip coder**: `kj run "audit security..."` now routes to security+audit roles without running coder/reviewer. Intent guard detects audit keywords in EN/ES (#269)

### Changed
- `kj doctor` shows RTK as MISS with install instructions when not found

## [1.50.1] - 2026-03-30

### Fixed
- **Pipeline messages respect configured language**: new message catalog (`src/utils/messages.js`) with EN/ES translations for triage, Solomon, checkpoints, preflight. All user-facing messages use `msg(key, lang)` instead of hardcoded English (#267)
- **Checkpoint UI restructured**: numbered options (1/2/3) instead of ambiguous answer field + Accept/Decline buttons. Each option explains what it does. Backward compatible with "yes"/"sí"/"no" (#266)
- 34 new tests

## [1.50.0] - 2026-03-30

### Added
- **71 unit tests** for server-handlers, pre-loop-stages, and iteration-stages. The 3 most critical modules now have dedicated test coverage (#260)

### Changed
- **Split 3 god-modules** into 12 focused sub-modules: server-handlers → 4 handler files, pre-loop-stages → 5 stage files, iteration-stages → 3 stage files. Original files become thin re-exporters. Zero API changes (#261)

## [1.49.0] - 2026-03-30

### Changed
- **Async I/O**: all sync file operations in basal-cost.js and store.js replaced with async equivalents. Prevents event loop blocking during long pipelines (#256)
- **Centralized SonarQube config**: new `sonar/config-resolver.js` replaces duplicated host/token/credentials resolution in scanner, preflight, and API modules. 14 new tests (#257)
- **Documented 61 empty catch blocks**: every silent catch now has an inline comment explaining intent. Zero logic changes, 39 files touched (#258)

## [1.48.0] - 2026-03-30

### Added
- **PG card lifecycle tracking** (epic KJC-PCS-0026): kj_run auto-marks PG cards In Progress at start, accumulates commits during pipeline, marks To Validate on approval with all commits and PR info. Best-effort, never blocks pipeline. 13 new tests (#254)
- **HU Board real-time status sync**: HU status transitions at each stage (coding → reviewing → done/failed), batch saved after each change for chokidar sync, hu:status-change events with timestamps. 9 new tests (#253)
- 2388 tests across 186 files

## [1.47.0] - 2026-03-30

### Added
- **HU Story Splitting**: linguistic indicator detection (6 categories: conjunctions, wildcard verbs, sequence, scope expansion, optionality, exceptions), heuristic-based sub-HU generation with FDE confirmation, 4-criteria validation (independently valuable, deployable alone, completable in 3 days, vertical). Horizontal splits rejected. Splitting metadata stored for traceability (#249, #250, #251)
- 64 new tests (2366 total across 184 files)

### Fixed
- **kj_audit MCP returns compact summary**: full audit details stay in session log, MCP response is compact JSON with health score, top 5 recommendations, and basal cost summary. Prevents host AI from receiving oversized payloads

## [1.46.0] - 2026-03-30

### Added
- **Parallel HU execution**: independent HUs run concurrently using git worktrees. `findParallelGroups` detects parallel batches, each HU gets its own worktree, results merge back sequentially. Failed HUs block dependents but not siblings. 13 new tests (#247)
- **SEA binary build**: `scripts/build-sea.mjs` bundles via esbuild and generates standalone binaries via Node 22 SEA. `.github/workflows/release-binaries.yml` produces kj-linux-x64, kj-macos-arm64, kj-win-x64.exe on every tag push (#246)
- **Python wrapper**: `wrappers/python/` with pip-installable package. `pip install .` provides `kj` command that delegates to npm global or npx (#245)
- **Docker image**: `Dockerfile` (Alpine + Node 20), `docker-compose.yml`, `docs/DOCKER.md` bilingual (#237)
- **Shell installer**: `scripts/install-kj.sh` for `curl | sh` installation with OS/arch detection (#238)
- 2318 tests across 182 files

## [1.45.0] - 2026-03-30

### Added
- **WebPerf Quality Gate** (epic KJC-PCS-0015): Core Web Vitals as pipeline quality gate
- **Chrome DevTools MCP detection**: auto-installs WebPerf Snippets skills (Joan Leon) when DevTools MCP configured (#242)
- **CWV evaluation**: LCP/CLS/INP measured against Google thresholds (good/needs-improvement/poor). Configurable via `webperf.thresholds` in kj.config.yml (#243)
- 30 new tests (2305 total across 181 files)

## [1.44.0] - 2026-03-30

### Added
- **i18n**: `kj init` detects OS locale and asks for pipeline language + HU language. Agents respond in the configured language. Supports English and Spanish, extensible. 18 new tests (#240)

## [1.43.0] - 2026-03-29

### Added
- **Docker image**: Alpine + Node 20, `docker run karajan-code kj --version`. Includes docker-compose.yml and bilingual docs/DOCKER.md (#237)
- **Shell installer**: `curl https://raw.githubusercontent.com/manufosela/karajan-code/main/scripts/install-kj.sh | sh` detects OS/arch, installs Node.js if needed, installs karajan-code, runs kj init (#238)

## [1.42.0] - 2026-03-29

### Added
- **Lean audit: basal cost** (epic KJC-PCS-0023): `kj audit` now measures dead code, unused dependencies, complexity growth between audits. Saves snapshots for trend tracking. Uses `git ls-files` for fast file enumeration (#235)
- **Lazy HU planning**: subsequent HUs are refined with context from completed ones instead of all planned upfront. First HU fully planned, rest get `needsRefinement: true` and are refined lazily (#234)
- 17 new tests (2257 total across 178 files)

## [1.41.0] - 2026-03-29

### Added
- **OpenSkills integration** (epic KJC-PCS-0024): Karajan auto-detects domain skills needed for each task
- **`kj_skills` MCP tool** (23rd): install, remove, list, read OpenSkills from marketplace or GitHub (#230)
- **Skill injection in prompts**: coder, reviewer, architect prompts now include domain-specific knowledge from installed skills (#231)
- **Triage auto-install**: detects frameworks (Astro, React, Vue, Express, etc.) and language markers, installs matching skills automatically, cleans up after pipeline (#232)
- 57 new tests (2240 total across 176 files)

## [1.40.0] - 2026-03-29

### Added
- **Pipeline sovereignty guard**: MCP handler validates kj_run params, strips host AI overrides (enableHuReviewer, enableTriage), clamps maxIterations [1,10], blocks duplicate sessions. 18 new tests (#227)
- **`kj_suggest` MCP tool** (22nd): host AI proposes observations to Solomon without override power. Solomon reads suggestions in next evaluation. 8 new tests (#228)
- **E2E install tests**: Docker smoke tests (14 checks) + GitHub Actions matrix (ubuntu, macOS, Windows). `kj init` disables sonar gracefully when Docker unavailable (#221, #222, #223, #226)
- **CLI update notification**: non-blocking npm version check at startup, cached 24h (#218)

## [1.39.0] - 2026-03-29

### Added
- **CLI update notification**: non-blocking check at startup, cached 24h. Shows available update with install command. 8 new tests (2157 total across 171 files)

## [1.38.2] - 2026-03-28

### Fixed
- **Reviewer sees new files**: `git add -A` before generating reviewer diff, so coder-created files are visible. Fixes scaffold tasks looping forever (#214)
- **Secrets always block**: all 15 credential patterns now critical severity. Hardcoded keys block the pipeline. Added: OpenAI, Anthropic, Stripe, Google, Firebase, Slack, JWT, database URLs (#213)
- **Coder .env mandate**: coder template explicitly requires `.env` + `process.env` for all keys, `.env.example` creation, `.gitignore` check

## [1.38.1] - 2026-03-28

### Added
- **`kj_hu` MCP tool** (21st tool): create, update, list, get HUs manually in the board. Auto-creates project from directory name + git remote (#208)
- **Multi-language TDD**: detects test frameworks for 12 languages (Java/JUnit, Python/pytest, Go, Rust/cargo, C#/.NET, Ruby/RSpec, PHP/PHPUnit, Swift/XCTest, Dart). TDD enforcement works for all languages, not just JS (#207)
- **MCP sovereignty**: tool descriptions explicitly instruct host AIs to pass tasks as-is without grouping, reordering, or overriding pipeline decisions (#210)
- 35 new tests (2142 total across 170 files)

### Fixed
- **Solomon messages**: escalation messages are now human-readable structured text instead of raw JSON. Shows reviewer feedback, Solomon decision, and clear options (#209)
- **Sonar token**: actionable error with 3 fix options when token is missing, instead of silently disabling sonar (#211)

## [1.38.0] - 2026-03-26

### Added
- **Integrated HU Manager** (epic KJC-PCS-0021): the HU system is now the nervous system for complex tasks
- **Triage auto-activates hu-reviewer**: medium/complex tasks get automatic story decomposition without manual flags (#197)
- **AI-driven task decomposition**: complex tasks decompose into 2-5 formal HUs with structured descriptions, acceptance criteria, and dependency graphs (#199)
- **Sub-pipeline per HU**: each certified HU runs as its own sub-pipeline (coder, sonar, reviewer) with per-HU state tracking (pending, coding, reviewing, done, failed, blocked). Failed HUs block dependents via transitive dependency resolution (#201)
- **PG adapter feeds hu-reviewer**: Planning Game card data (descriptionStructured, acceptanceCriteria) automatically converted to HU format when pgTaskId is set (#200)
- **History records for all pipeline runs**: every pipeline run (simple or complex) creates a lightweight HU record visible in the HU Board (#198)
- **"Why vanilla JavaScript?" essay**: personal perspective on the JS vs TS choice (docs/why-vanilla-js.md)
- 49 new tests (2093 total across 166 files)

## [1.37.0] - 2026-03-25

### Added
- **Injection guard**: prompt injection scanner for AI-reviewed diffs and PRs. Scans diffs before passing them to AI reviewers, detecting directive overrides ("ignore previous instructions"), invisible Unicode characters (zero-width spaces, bidi overrides), and oversized comment block payloads. Integrated in pipeline (blocks review) and as GitHub Action on every PR
- **Community templates**: CODE_OF_CONDUCT.md, CONTRIBUTING.md, issue/PR templates (bilingual EN/ES)
- **Executor info in pipeline output**: all stage events show provider name and execution type (AI/skill/local)
- **Windows compatibility**: `where` instead of `which`, AppData search dirs, .cmd/.exe/.bat extensions, SIGTERM on Windows, Windows install commands
- 33 new injection guard tests (2044 total across 161 files)

### Fixed
- CI test failures (missing mocks after vi.resetAllMocks)
- Branch protection enabled on main (PR required)
- Auto-delete merged branches enabled

### Security
- SECURITY.md made bilingual (EN + ES)

## [1.36.1] - 2026-03-25

### Added
- **kj-tail as installable CLI command**: `kj-tail` with `--help`, filtering (`-v`, `-t`, `-s`, `-n`), and snapshot mode
- **Three ways to use Karajan** documented: CLI, MCP, kj-tail with full pipeline example
- **Executor info**: provider and execution type (AI/skill/local) in all pipeline stage events

### Fixed
- Propagate Solomon error details to escalation and activity log

## [1.36.0] - 2026-03-25

### Added
- **Budget tracking from real agent usage**: Claude agent extracts `tokens_in`, `tokens_out`, `cost_usd` and `model` from CLI JSON output. Codex agent parses `tokens used` from stdout. Budget display now shows real costs instead of "N/A"
- **Token estimation fallback**: when agents don't report usage, budget tracker estimates tokens from output text length (~4 chars/token). Marked as `estimated: true` in budget entries
- **Solomon error propagation**: Solomon failure details now logged to activity log, shown in event messages, saved in session checkpoints, and passed as escalation reason (previously showed "UNKNOWN")

### Fixed
- **Model-not-supported resilience**: all agents (Claude, Codex, Gemini, Aider, OpenCode) detect "model not supported" errors and automatically retry without the custom model flag, falling back to the agent's default model. Prevents pipeline failures when smart model selection picks a model unavailable for the user's account tier
- **Solomon context for first rejections**: Solomon now receives `isFirstRejection`, `isRepeat`, `issueCategories` and `blockingIssues` in its prompt, enabling correct `approve_with_conditions` decisions on first reviewer rejections instead of unnecessary human escalation

## [1.35.0] - 2026-03-24

### Added
- **Mandatory bootstrap gate**: new `.kj-ready.json` checkpoint per project that validates ALL environment prerequisites before any KJ tool executes. Checks: git repo, git remote origin, KJ config, core binaries (node/npm/git), coder agent CLI, SonarQube (when enabled). Results cached for 24 hours. If any check fails, KJ stops with a clear error message and actionable fix instructions — no silent fallbacks or graceful degradation
- **Bootstrap gate on 12 MCP handlers**: `kj_run`, `kj_code`, `kj_review`, `kj_plan`, `kj_discover`, `kj_triage`, `kj_researcher`, `kj_architect`, `kj_audit`, `kj_resume`, `kj_scan` all validate environment before execution
- **Secure SonarQube credentials file**: `~/.karajan/sonar-credentials.json` for admin credentials. Format: `{"user": "admin", "password": "your-password"}`
- **`bootstrap_error` classification**: bootstrap failures classified as non-recoverable — auto-resume will not retry
- 19 new bootstrap tests + 1 error classification test (1966 total)

### Fixed
- **Hard-fail preflight checks**: SonarQube preflight checks during pipeline execution now BLOCK the pipeline (`ok: false` + `errors[]`) instead of silently auto-disabling SonarQube via `configOverrides.sonarDisabled`. Security agent checks remain graceful (warning only)

### Security
- **Removed default admin/admin SonarQube credentials**: the hardcoded `"admin"` password fallback in `resolveSonarToken()` and `checkSonarAuth()` has been removed. Credential resolution chain is now: (1) `KJ_SONAR_TOKEN` / `SONAR_TOKEN` env var, (2) `sonarqube.token` in `kj.config.yml`, (3) admin credentials from env vars / config / `~/.karajan/sonar-credentials.json`. Hard fail with actionable message if nothing configured
- **`admin_user` default changed from `"admin"` to `null`** in config defaults — explicit configuration required

### Changed
- `src/orchestrator/preflight-checks.js`: result now includes `errors: []` field alongside existing `warnings: []`
- `src/orchestrator.js`: consumes `preflightResult.ok === false` and throws Error with fix instructions
- `.gitignore`: added `.kj-ready.json`

## [1.34.4] - 2026-03-23

### Fixed
- **OS-aware install commands**: macOS uses `brew install`, Linux uses `curl`/`apt`/`pipx` for agent CLI installation suggestions in `kj doctor` and error messages

## [1.34.3] - 2026-03-22

### Changed
- **Cognitive complexity refactoring**: reduced cognitive complexity across 6 core files

## [1.34.2] - 2026-03-22

### Fixed
- **Zero skipped tests**: eliminated all skipped tests + added 44 board backend tests

## [1.20.0] - 2026-03-14

### Added
- **Standalone CLI commands**: `kj discover`, `kj triage`, `kj researcher`, `kj architect` — clean subcommands for running pre-loop roles independently, instead of requiring `kj run --enable-*` flags
- Each command supports role-specific flags: `--mode` for discover, `--context` for architect, `--json` for structured output

## [1.19.0] - 2026-03-14

### Added
- **OpenCode agent**: 5th built-in AI agent — open-source CLI with multi-provider support. Contributed by [@aitorGeniova](https://github.com/aitorGeniova) (#75)

## [1.18.0] - 2026-03-14

### Added
- **Output guard**: scans git diffs for destructive operations (rm -rf, DROP TABLE, git push --force), exposed credentials (AWS keys, private keys, tokens), and protected file modifications. Blocks pipeline on critical violations.
- **Perf guard**: scans frontend file diffs for performance anti-patterns (images without dimensions/lazy, render-blocking scripts, missing font-display, document.write, heavy deps). Advisory by default, configurable to block.
- **Intent classifier**: keyword-based deterministic pre-triage classification. Classifies obvious task types (doc, add-tests, refactor, infra, trivial-fix) without LLM call when enabled.
- **Guards config schema**: `guards.output`, `guards.perf`, `guards.intent` in kj.config.yml with custom patterns, protected files, and confidence thresholds
- **Pipeline guard integration**: guards run between coder+refactorer and quality gates; intent classifier runs before discover/triage in pre-loop

## [1.17.0] - 2026-03-14

### Added
- **ArchitectRole**: new pre-construction design role that defines solution architecture (layers, patterns, data model, API contracts, tradeoffs) between researcher and planner stages
- **Interactive architecture pause**: when architect detects ambiguity (`verdict: "needs_clarification"`), pipeline pauses to ask targeted questions via `askQuestion`
- **Auto ADR generation**: architectural decisions from tradeoffs are automatically persisted as Architecture Decision Records in Planning Game when a card is linked
- **Triage → architect activation**: triage automatically activates architect based on task complexity, scope (new modules, data model changes), and design ambiguity
- **Planner architectContext**: planner receives and uses architectural decisions to generate implementation steps aligned with the designed architecture
- **`--enable-architect` CLI flag** and `enableArchitect`/`architectModel` MCP parameters for explicit control
- **`templates/roles/architect.md`**: LLM instruction template for the architect role

### Changed
- **SonarQube full cleanup**: resolved all 205 open issues (CRITICAL, MAJOR, MINOR) — 0 remaining
- **Cognitive complexity refactoring**: orchestrator.js (345→15), display.js (134→2), server-handlers.js (101→3), config.js (55→10), and 14 other files
- **Handler dispatch maps**: replaced large switch/if-else chains with object dispatch maps in display.js, server-handlers.js, and config.js
- **MCP server**: migrated from deprecated `Server` to `McpServer` class
- **Modern JS**: replaceAll, RegExp.exec, Number.parseInt, Set.has, structuredClone across 50+ files

## [1.16.0] - 2026-03-11

### Added
- **DiscoverRole**: new pre-execution validation role that analyzes tasks for gaps, ambiguities, and missing information before pipeline execution
- **5 discovery modes**: `gaps` (default gap detection), `momtest` (Mom Test question generation), `wendel` (behavior change adoption checklist), `classify` (START/STOP/DIFFERENT classification), `jtbd` (Jobs-to-be-Done generation)
- **`kj_discover` MCP tool**: standalone gap detection tool with mode, context, and Planning Game task integration
- **Pipeline integration**: discover runs as opt-in pre-pipeline stage before triage (`--enable-discover` flag or `pipeline.discover.enabled` config)
- **Non-blocking discovery**: discover failures log warnings and continue pipeline execution gracefully

## [1.15.0] - 2026-03-11

### Added
- **Triage taskType classification**: triage now classifies tasks as sw, infra, doc, add-tests, or refactor for policy-driven pipeline gating
- **`--taskType` parameter**: explicit taskType override for `kj_run` CLI and MCP tool, bypasses triage classification
- **Mandatory triage**: triage always runs to classify taskType; can activate roles but respects pipeline config for explicitly enabled roles
- **Triage → policy integration**: taskType from triage feeds into policy-resolver (priority: flags > config > triage > default sw)

## [1.14.0] - 2026-03-11

### Added
- **Policy resolver**: new `src/guards/policy-resolver.js` module maps taskType (sw, infra, doc, add-tests, refactor) to pipeline policies (tdd, sonar, reviewer, testsRequired) with per-project config overrides
- **Pipeline policy gating**: orchestrator applies resolved policies to gate TDD, SonarQube, and reviewer stages based on taskType, emits `policies:resolved` event
- **Config immutability**: policy gates use shallow copies, never mutating the caller's config object

## [1.13.2] - 2026-03-10

### Fixed
- **npm bin entries removed during publish**: npm 11.x rejected `bin` entries pointing directly to `src/`. Created proper wrapper scripts in `bin/kj` and `bin/karajan-mcp` that delegate to the source files

## [1.13.1] - 2026-03-10

### Fixed
- **Claude subprocess incompatible with Claude Code v2.1.71**: `--print` combined with `--output-format stream-json` now requires `--verbose` flag. Added `--verbose` to both `runTask` (streaming) and `reviewTask` in `ClaudeAgent`

## [1.13.0] - 2026-03-08

### Added
- **BecarIA Gateway integration**: full CI/CD integration with GitHub PRs via repository_dispatch events. PRs become the source of truth for the pipeline
- **Early PR creation**: PR created after first coder iteration (before reviewer), subsequent iterations push incrementally
- **All-agent dispatch comments**: Sonar, Solomon, Tester, Security, Planner, Coder, and Reviewer all post comments on the PR with their results
- **Formal PR reviews**: Reviewer dispatches APPROVE/REQUEST_CHANGES via becaria-review event
- **Configurable dispatch**: custom event types (`review_event`, `comment_event`) and optional `[Agent]` prefix via `becaria` config section
- **PR-based review**: Reviewer reads `gh pr diff` instead of local `git diff` when BecarIA is enabled
- **`kj review` standalone with BecarIA**: reads PR diff, dispatches review result, errors if no open PR
- **Repo and PR auto-detection**: `detectRepo()` parses SSH/HTTPS remotes, `detectPrNumber()` uses `gh pr view`
- **BecarIA workflow templates**: `becaria-gateway.yml`, `automerge.yml`, `houston-override.yml` embedded in package
- **`kj init --scaffold-becaria`**: copies workflow templates to `.github/workflows/`
- **`kj doctor` BecarIA checks**: verifies workflows, gh CLI, and GitHub secrets when BecarIA enabled
- **`--enable-becaria` flag**: CLI and MCP support, auto-enables git automation (commit + push + PR)
- 50 new tests for BecarIA modules (1230 total across 111 test files)

## [1.12.0] - 2026-03-07

### Added
- **Intelligent reviewer mediation**: when the reviewer flags out-of-scope issues (files not in the diff), the scope filter auto-defers them instead of blocking the pipeline. Deferred issues are tracked as technical debt in the session and injected into the coder prompt as context
- **Deferred issues tracking**: out-of-scope reviewer concerns are stored in `session.deferred_issues` with structured metadata (file, severity, description, suggested_fix). Returned in `deferredIssues` field of the session result for follow-up task creation
- **Solomon mediation on reviewer stall**: when `RepeatDetector` detects a stalled reviewer (same issues repeated), Solomon now arbitrates before stopping — can override, continue with guidance, or create subtask. Falls back to pause only if Solomon can't resolve
- **Solomon rule: reviewer_overreach**: new rule detects when the reviewer consistently flags out-of-scope issues that get auto-demoted by the scope filter
- **Deferred context in coder prompt**: the coder receives a "Deferred reviewer concerns" section listing tracked tech debt, so it can naturally address issues if its changes touch the relevant areas
- 4 new tests for scope filter and deferred context (1196 total)

## [1.11.1] - 2026-03-07

### Fixed
- **Claude subprocess blocked on permissions**: `claude -p` runs non-interactively (`stdin: "ignore"`) but without `--allowedTools`, it blocks waiting for permission approval that never arrives. Now passes `--allowedTools Read Write Edit Bash Glob Grep` to both `runTask` and `reviewTask`

## [1.11.0] - 2026-03-07

### Added
- **Rate-limit standby with auto-retry**: when a coder/reviewer hits a rate limit, Karajan now parses the cooldown time (5 message patterns supported), waits with exponential backoff (5min default, 30min max, 5 retries), then auto-resumes. Emits standby/heartbeat/resume events for real-time monitoring
- **Preflight handshake**: `kj_preflight` tool requires human confirmation of agent config before `kj_run`/`kj_code`. Prevents AI from silently overriding agent assignments. Supports natural language ("use gemini as coder")
- **Session-scoped agent config**: `kj_agents` via MCP defaults to session scope (in-memory, dies with server restart). CLI defaults to project scope. Both override global config
- **Pipeline intelligence — triage as pipeline director**: triage analyzes task complexity and returns role activation decisions (tester, security, refactorer, researcher). Enabled by default
- **Tester and security enabled by default**: pipeline now runs tester and security checks unless explicitly disabled
- **Solomon supervisor**: runs after each iteration with 4 rules (max_files_per_iteration, max_stale_iterations, dependency_guard, scope_guard). Pauses on critical alerts and asks for human input
- **3-tier config merge**: DEFAULTS < global (~/.karajan/) < project (.karajan/)
- **MCP progress streaming for kj_code/kj_review/kj_plan**: `notifications/progress` now sent by all direct handlers (was only kj_run). Hosts that support progressToken (like Claude Code) show real-time stage progress
- **Enhanced kj_status**: returns parsed status summary (currentStage, currentAgent, iteration, isRunning, recent errors) alongside raw log lines
- **kj-tail resilient tracking**: uses `tail -F` instead of `tail -f` to survive log file truncation across runs
- ADR documenting MCP progress notification investigation
- 76 new tests (1180 total across 106 test files)

## [1.10.1] - 2026-03-07

### Added
- **Planning Game auto-status in `runFlow`**: when `pgTaskId` is provided, Karajan now automatically marks the PG card as "In Progress" (with `startDate`, `developer: BecarIA`) at session start, and "To Validate" (with `endDate`, `commits`) on approved completion. Works from both CLI and MCP — no duplicate logic needed
- 6 new tests for PG integration (1090 total)

### Changed
- **CLI `run.js` simplified**: PG card fetch and completion update logic moved to `runFlow` (was duplicated in CLI handler)

## [1.10.0] - 2026-03-07

### Added
- **`kj_agents` MCP tool and CLI command**: list or change AI agent assignments per role on the fly. `kj_agents set coder gemini` persists to `kj.config.yml` — no restart needed, next `kj_run`/`kj_code` picks it up immediately
- **`kj doctor` version display**: first line now shows Karajan Code version (`OK   Karajan Code: v1.10.0`)
- **Subprocess constraints in coder prompt**: tells the coder it runs non-interactively (no stdin/TTY), must use `--yes`/`--no-input` flags for CLI wizards, and report clearly if a task cannot be done non-interactively
- 10 new tests (1084 total)

### Fixed
- **Checkpoint null response no longer kills sessions**: when `elicitInput` fails or the AI agent returns null/empty, the session now continues for 5 more minutes instead of stopping. Only an explicit "4" or "stop" triggers a session stop
- **`kj_resume` accepts stopped and failed sessions**: previously only "paused" sessions could be resumed. Now stopped (checkpoint) and failed (timeout/max-iterations) sessions can be re-run with `kj_resume`

## [1.9.6] - 2026-03-06

### Fixed
- **Claude subprocess compatibility**: Fixed three issues preventing `claude -p` from working as a subprocess in Node.js: (1) strip `CLAUDECODE` env var to bypass nesting guard, (2) detach stdin (`stdin: "ignore"`) to prevent blocking on inherited parent stdin, (3) read structured output from stderr where Claude Code 2.x writes it instead of stdout. Also changed `reviewTask` to use `stream-json` for real-time feedback.
- **Config default test**: fixed flaky `max_iteration_minutes` test that read the local `kj.config.yml` instead of testing the hardcoded default

## [1.9.4] - 2026-03-06

### Fixed
- **Branch guard for MCP tools**: `kj_run`, `kj_code`, and `kj_review` now reject execution when on the base branch (main). The diff against `origin/main` is empty on the same branch, making the reviewer stage useless. A clear error message instructs AI agents to create a feature branch first.

### Added
- New `branch_error` category in MCP error classification with actionable suggestion

## [1.9.3] - 2026-03-04

### Added
- **Planner hard runtime cap**: new `session.max_planner_minutes` (default 60) to stop noisy-but-stuck planner runs that still emit output (e.g. reconnect loops)

### Changed
- **Codex prompt transport hardening**: `CodexAgent` now sends prompts through stdin (`codex exec -`) instead of argv to handle very large planner prompts more reliably
- **Planner timeout wiring in all entrypoints**: `kj_plan` (MCP), `PlannerRole`, and CLI `kj plan` now pass both silence and runtime timeouts to agent execution
- **Docs updated**: README + troubleshooting (EN/ES) now document `max_planner_minutes` behavior and tuning guidance

## [1.9.2] - 2026-03-04

### Added
- **Planner anti-stall guardrails**: configurable `session.max_agent_silence_minutes` (default 20) to stop planner executions that remain silent for too long
- **Richer heartbeat telemetry**: heartbeat events are now emitted continuously, including `silenceMs` and wait/active status, so long-running calls remain observable
- **Repeated stall notifications**: warning/critical stall events are re-emitted periodically during prolonged silence (instead of a single warning)
- **Robust stream parsing in process runner**: `runCommand` now handles `CR`, `LF`, and `CRLF` separators and flushes partial output buffers periodically for CLIs that do not terminate lines

### Changed
- **`kj_plan` diagnostics** now include max-silence configuration at start and append runtime stats (`lines`, `bytes`, `elapsed`) on planner failure to speed up troubleshooting
- **MCP error classification** includes `agent_stall` with actionable guidance (`kj_status`, smaller prompt, or increase silence timeout)

## [1.9.1] - 2026-03-03

### Added
- **`kj update` CLI command**: checks npm for the latest version and runs `npm install -g karajan-code@latest` to self-update

## [1.9.0] - 2026-03-03

### Added
- **Real-time feedback for all pipeline stages**: planner, triage, researcher, and refactorer now propagate `onOutput` callbacks, providing live progress during execution
- **Stall detector** (`src/utils/stall-detector.js`): monitors agent activity with heartbeat (30s), warning (2min), and critical (5min) thresholds to detect hung agents
- **File-based run log** (`src/utils/run-log.js`): writes real-time progress to `<projectDir>/.kj/run.log`, monitorable with `tail -f` or `kj_status`
- **`kj_status` MCP tool**: reads the current run log so Claude can show what Karajan is doing in real-time
- **Stream-JSON for Claude CLI**: when `onOutput` is provided, uses `--output-format stream-json` to get real-time NDJSON streaming instead of buffered text output
- **MCP roots-based project directory detection**: uses `server.listRoots()` to resolve the user's project directory instead of `process.cwd()`, fixing run.log placement when MCP runs from a different directory
- New progress event types: `agent:heartbeat`, `agent:stall`, `triage:start/end`, `researcher:start/end`
- 9 new tests for stall detector (1053 total)

## [1.8.0] - 2026-03-02

### Added
- **Pipeline stage tracker**: new `pipeline:tracker` event emitted after every stage transition during `kj_run`, carrying full cumulative state (done/running/pending/failed) for all pipeline stages
- **Single-agent progress logging**: `kj_code`, `kj_review`, and `kj_plan` now emit tracker start/end logs so MCP hosts can show which agent is running
- **CLI pipeline rendering**: `kj run` displays a cumulative pipeline box with status icons per stage
- New exported helpers: `buildPipelineTracker(config, emitter)` and `sendTrackerLog(server, stageName, status, summary)`
- 12 new tests (1044 total)

## [1.7.0] - 2026-03-02

### Fixed
- **kj_plan/kj_code/kj_review SIGKILL timeout**: these three MCP tools were spawned as subprocesses via execa. When the caller passed `timeoutMs`, execa killed the subprocess with SIGKILL. They now execute in-process (like `kj_run`), with no timeout — the agent runs until done
- **MCP server stale after update**: after `npm link`/`npm install`, the MCP process kept running old ESM-cached code. Added `setupVersionWatcher` that detects `package.json` version changes and exits cleanly so Claude Code restarts the server with fresh code. Also added per-call version check as fallback
- **Hardcoded versions**: replaced hardcoded version strings in `cli.js` (`"1.6.2"`), `display.js` (`"0.1.0"`), and `server.js` (`"1.0.0"`) with dynamic reads from `package.json`

### Changed
- `timeoutMs` parameter removed from `kj_code`, `kj_review`, `kj_plan` MCP tool schemas
- MCP server now reports its actual package version in the `Server` constructor
- 5 new tests (1030 total)

## [1.6.2] - 2026-03-02

### Fixed
- **Init wizard skipped config questions with single agent**: when only one AI agent was installed, `kj init` auto-assigned it to all roles and exited without asking about triage, SonarQube, or methodology. Now all config questions are always asked regardless of agent count

## [1.6.1] - 2026-03-02

### Fixed
- **Agent subprocess timeout removed**: all 4 agent implementations (Claude, Codex, Gemini, Aider) had a hardcoded timeout of `max_iteration_minutes` (default 30 min) that killed the subprocess with SIGKILL. This was the actual cause of the "31 min timeout" — the orchestrator-level fix in v1.6.0 was incomplete. Agents now run without timeout; the orchestrator manages time via interactive checkpoints (MCP) or hard timeout (CLI)

## [1.6.0] - 2026-03-02

### Added
- **Interactive timeout checkpoints**: replaces the hard timeout that killed running processes. Every 5 minutes (configurable with `--checkpoint-interval`), pauses execution with a progress report and asks the user to continue (5 more min / until done / custom time / stop). Only applies when `askQuestion` is available (MCP `kj_run`); subprocess commands (`kj_code`, `kj_review`) run without timeout by default
- **PG subtask creation from triage decomposition**: when triage recommends decomposing a task and a Planning Game card is linked, offers to create subtask cards in PG with `blocks/blockedBy` chain relationships for sequential execution
- **Triage task decomposition**: triage now analyzes whether tasks should be split, returning `shouldDecompose` and `subtasks[]` fields with up to 5 actionable subtask descriptions
- **Planner receives triage decomposition**: planner prompt includes triage decomposition context, focusing the plan on the first subtask with remaining subtasks documented as `pending_subtasks`
- **PR body enrichment**: auto-generated PR body includes approach, implementation steps, and pending subtasks as checkboxes from triage decomposition
- **Planning Game card traceability**: session reports now include `pg_task_id`/`pg_project_id`, with `--pg-task` filtering support in `kj report` and MCP `kj_report`
- **Provider and model in checkpoints**: all session checkpoints now record which provider and model were used for each stage
- PG HTTP client methods: `createCard()` and `relateCards()` for card creation and relationship management
- CLI flag: `--checkpoint-interval <n>` to control minutes between interactive checkpoints
- MCP parameter: `checkpointInterval` for `kj_run`
- 61 new tests (1025 total)

### Fixed
- **Timeout regression**: removed the forced timeout in `run-kj.js` that prevented tasks from completing. Subprocess timeout now only applies when explicitly set via `timeoutMs`
- Timeout race condition between MCP host and agent subprocess resolved

### Changed
- `session.checkpoint_interval_minutes` default: 5 (previously hard timeout at 30 min)
- Subprocess timeout behavior: no timeout by default (was always imposed via `resolveTimeout()`)

## [1.5.0] - 2026-03-01

### Added
- **Smart model selection**: automatically selects optimal model per role based on triage complexity level — trivial/simple tasks use lighter models (haiku, flash, o4-mini), complex tasks use powerful models (opus, o3, pro)
- CLI flags: `--smart-models` / `--no-smart-models` to enable/disable smart model selection
- MCP parameter: `smartModels` for `kj_run`
- New module `src/utils/model-selector.js` with configurable tier maps and role overrides
- User-configurable tiers and role overrides via `model_selection` in `kj.config.yml`
- Reviewer role override: always uses at least "medium" tier for review quality
- Triage role override: always uses lightweight models regardless of task complexity
- 34 new tests (964 total)

### Changed
- `model_selection.enabled: true` by default — smart selection activates automatically when triage is enabled
- Explicit `--coder-model` / `--reviewer-model` flags always take precedence over smart selection

## [1.4.0] - 2026-03-01

### Added
- **Auto-fallback to available agent**: when the primary agent hits a rate limit, Karajan automatically falls back to another available agent for the same role (#66)
- 7 new tests (930 total)

## [1.3.0] - 2026-03-01

### Added
- **Rate limit detection**: detects CLI agent rate limits (Claude, Codex) and pauses the session instead of failing, allowing resumption when the token window resets (#65)
- 5 new tests (923 total)

## [1.2.0] - 2026-02-28

### Added
- **`kj report --trace`**: chronological pipeline stage breakdown with per-stage provider, duration, tokens in/out, and cost in USD/EUR (#55)
- **`kj init` interactive wizard**: auto-detects installed agents (claude, codex, gemini, aider) and guides configuration; single agent auto-assigns all roles without prompting (#56)
- **`kj roles` command**: list pipeline roles with provider/status or show `.md` template instructions; supports custom project overrides (#57)
- MCP tool `kj_roles` with `list`/`show` actions
- CLI flags: `--trace`, `--currency` for report; `--no-interactive` for init
- Budget config: `budget.currency` and `budget.exchange_rate_eur` defaults
- Shared `agent-detect` module extracted from `doctor` for reuse in `init`
- 41 new tests (762 total)

## [1.1.0] - 2026-02-28

### Added
- **Dynamic triage pipeline**: `TriageRole` classifies task complexity (trivial/simple/medium/complex) and activates only necessary pipeline roles (#53)
- **Optional Serena MCP integration**: symbol-level code navigation (`find_symbol`, `find_referencing_symbols`, `insert_after_symbol`) injected into coder/reviewer prompts when `serena.enabled=true` (#54)
- CLI flags: `--enable-triage`, `--enable-serena`, `--enable-reviewer`, `--enable-researcher`, `--enable-tester`, `--enable-security`
- MCP parameters: `enableTriage`, `enableSerena`, `enableReviewer`, `enableResearcher`, `enableTester`, `enableSecurity`
- Serena availability check in `kj doctor`
- 17 new tests (721 total)

### Changed
- Reviewer is now conditionally skippable via triage or `--enable-reviewer=false`
- Pipeline role flags (planner, refactorer, researcher, tester, security) now validated in `requiredRolesFor()`

## [1.0.0] - 2026-02-28

### Added
- `package.json` metadata for npm publish (repository, keywords, engines, author, license, files)
- `SECURITY.md` with vulnerability reporting policy
- `CHANGELOG.md` following Keep a Changelog format
- Pre-commit hook blocking LLM attribution in commits (`.githooks/pre-commit`)
- `RefactorerRole` class with BaseRole lifecycle (`src/roles/refactorer-role.js`)
- Refactorer role template (`templates/roles/refactorer.md`)
- Per-model pricing module (`src/utils/pricing.js`) with `calculateUsageCostUsd`, `mergePricing`, and `DEFAULT_MODEL_PRICING`
- Installer end-to-end validation (#52)

### Fixed
- SonarQube host URL in token setup instructions (#52)
- Missing files from orchestrator pipeline (pricing, refactorer role, refactorer template)

## [0.2.0] - 2026-02-27

### Added
- Per-model pricing table for accurate budget tracking in USD (#49)
- `kj report` command with session export and `--format json` (#50)
- Model selection flags `--coder-model`, `--reviewer-model`, `--planner-model` per role (#45)
- Planning-game client with timeout, network error, and JSON parse handling (#46)
- `buildTaskPrompt` and `updateCardOnCompletion` in planning-game adapter (#46)
- Configurable SonarQube settings: container name, volumes, network, timeouts (#47)
- Support for external SonarQube with `sonarqube.external=true` (#47)
- `RefactorerRole` export and template verification (#48)

### Fixed
- `coderModel` flag no longer leaks into other roles' model selection (#45)

## [0.1.0] - 2026-02-24

### Added
- **Core orchestrator**: coder -> sonar -> reviewer loop with configurable iterations
- **CLI commands**: `init`, `config`, `run`, `code`, `review`, `scan`, `doctor`, `plan`, `resume`, `sonar`
- **4 AI agents**: Claude, Codex, Gemini, Aider with auto-detection
- **10 pipeline roles**: Planner, Coder, Refactorer, Reviewer, Tester, Security, Researcher, Sonar, Solomon, Commiter
- **BaseRole abstraction** with standardized lifecycle (init -> execute -> report)
- **Role .md templates** with custom instruction support per project
- **SonarQube integration**: Docker management, quality gates, enforcement profiles
- **TDD-by-default** methodology with test change enforcement
- **Review profiles**: standard, strict, paranoid, relaxed, custom
- **Budget tracking**: token and cost tracking per session
- **Planning Game MCP integration**: task context and completion updates
- **MCP server** with 10 tools and real-time progress notifications
- **Session management**: pause/resume, fail-fast detection, activity logging
- **Git automation**: auto-commit, auto-push, auto-PR, auto-rebase
- **Streaming output**: real-time agent output in CLI and MCP
- **Solomon arbitration**: conflict resolution between AI agents
- **Interactive installer**: one-command setup with multi-instance support
- **CI/CD**: GitHub Actions workflow with validation and PR annotations
- **716+ unit tests** with Vitest

[Unreleased]: https://github.com/manufosela/karajan-code/compare/v1.56.0...HEAD
[1.56.0]: https://github.com/manufosela/karajan-code/compare/v1.55.0...v1.56.0
[1.55.0]: https://github.com/manufosela/karajan-code/compare/v1.54.0...v1.55.0
[1.54.0]: https://github.com/manufosela/karajan-code/compare/v1.53.1...v1.54.0
[1.53.1]: https://github.com/manufosela/karajan-code/compare/v1.53.0...v1.53.1
[1.53.0]: https://github.com/manufosela/karajan-code/compare/v1.52.0...v1.53.0
[1.52.0]: https://github.com/manufosela/karajan-code/compare/v1.51.0...v1.52.0
[1.51.0]: https://github.com/manufosela/karajan-code/compare/v1.50.1...v1.51.0
[1.50.1]: https://github.com/manufosela/karajan-code/compare/v1.50.0...v1.50.1
[1.50.0]: https://github.com/manufosela/karajan-code/compare/v1.49.0...v1.50.0
[1.49.0]: https://github.com/manufosela/karajan-code/compare/v1.48.0...v1.49.0
[1.48.0]: https://github.com/manufosela/karajan-code/compare/v1.47.0...v1.48.0
[1.47.0]: https://github.com/manufosela/karajan-code/compare/v1.46.0...v1.47.0
[1.46.0]: https://github.com/manufosela/karajan-code/compare/v1.45.0...v1.46.0
[1.45.0]: https://github.com/manufosela/karajan-code/compare/v1.44.0...v1.45.0
[1.44.0]: https://github.com/manufosela/karajan-code/compare/v1.43.0...v1.44.0
[1.43.0]: https://github.com/manufosela/karajan-code/compare/v1.42.0...v1.43.0
[1.42.0]: https://github.com/manufosela/karajan-code/compare/v1.41.0...v1.42.0
[1.41.0]: https://github.com/manufosela/karajan-code/compare/v1.40.0...v1.41.0
[1.40.0]: https://github.com/manufosela/karajan-code/compare/v1.39.0...v1.40.0
[1.39.0]: https://github.com/manufosela/karajan-code/compare/v1.38.2...v1.39.0
[1.38.2]: https://github.com/manufosela/karajan-code/compare/v1.38.1...v1.38.2
[1.38.1]: https://github.com/manufosela/karajan-code/compare/v1.38.0...v1.38.1
[1.38.0]: https://github.com/manufosela/karajan-code/compare/v1.37.0...v1.38.0
[1.37.0]: https://github.com/manufosela/karajan-code/compare/v1.36.1...v1.37.0
[1.36.1]: https://github.com/manufosela/karajan-code/compare/v1.36.0...v1.36.1
[1.36.0]: https://github.com/manufosela/karajan-code/compare/v1.35.0...v1.36.0
[1.35.0]: https://github.com/manufosela/karajan-code/compare/v1.34.4...v1.35.0
[1.34.4]: https://github.com/manufosela/karajan-code/compare/v1.34.3...v1.34.4
[1.34.3]: https://github.com/manufosela/karajan-code/compare/v1.34.2...v1.34.3
[1.34.2]: https://github.com/manufosela/karajan-code/compare/v1.20.0...v1.34.2
[1.13.2]: https://github.com/manufosela/karajan-code/compare/v1.13.1...v1.13.2
[1.13.1]: https://github.com/manufosela/karajan-code/compare/v1.13.0...v1.13.1
[1.13.0]: https://github.com/manufosela/karajan-code/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/manufosela/karajan-code/compare/v1.11.1...v1.12.0
[1.11.1]: https://github.com/manufosela/karajan-code/compare/v1.11.0...v1.11.1
[1.11.0]: https://github.com/manufosela/karajan-code/compare/v1.10.1...v1.11.0
[1.10.1]: https://github.com/manufosela/karajan-code/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/manufosela/karajan-code/compare/v1.9.6...v1.10.0
[1.9.6]: https://github.com/manufosela/karajan-code/compare/v1.9.4...v1.9.6
[1.9.3]: https://github.com/manufosela/karajan-code/compare/v1.9.2...v1.9.3
[1.9.2]: https://github.com/manufosela/karajan-code/compare/v1.9.1...v1.9.2
[1.8.0]: https://github.com/manufosela/karajan-code/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/manufosela/karajan-code/compare/v1.6.2...v1.7.0
[1.6.2]: https://github.com/manufosela/karajan-code/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/manufosela/karajan-code/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/manufosela/karajan-code/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/manufosela/karajan-code/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/manufosela/karajan-code/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/manufosela/karajan-code/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/manufosela/karajan-code/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/manufosela/karajan-code/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/manufosela/karajan-code/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/manufosela/karajan-code/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/manufosela/karajan-code/releases/tag/v0.1.0
