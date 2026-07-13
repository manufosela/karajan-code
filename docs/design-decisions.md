# Design decisions — things Karajan deliberately does NOT do

Security and code reviews of the pipeline keep proposing the same "obvious"
hardening measures. Most of them were already considered and rejected **by
design**, because in this runtime they trade a real capability for a false sense
of safety. This page records those decisions so they don't get re-litigated on
every review.

If you are about to recommend one of the items below, read its entry first — and
if the reasoning no longer holds, update the entry in the same PR that changes
the behaviour.

## Why `npm install` is not run with `--ignore-scripts`

The Brain can issue a dependency install as a *direct action*
(`src/orchestrator/direct-actions.js`) — but only in one situation: **tests are
failing because `node_modules` is missing**. The whole point of that install is to make the project's real test
suite run. `--ignore-scripts` would defeat it:

- Native modules build their addon in a `postinstall` script. `better-sqlite3`
  (which the HU Board, RAG and cost tracking all depend on) is the obvious one,
  but `bcrypt`, `sharp` and many others behave the same way. With scripts
  disabled the package installs but never compiles, and the failure surfaces
  later as a confusing `Cannot find module` at runtime — exactly the class of
  breakage tracked in **KJC-BUG-0092** (pnpm silently skipping the native
  build). That violates the project rule *"el sistema funciona o falla, nunca
  silenciosamente"*.
- It would not close a meaningful hole. The coder agent already runs arbitrary
  build and test commands under the user's own identity. A hostile
  `postinstall` opens no privilege boundary that the coder didn't already have.

**Where the real boundary is:** not in `--ignore-scripts`, but in
`src/orchestrator/direct-actions.js`:

- `run_command` only executes commands on a fixed **allow-list** (`npm install`,
  `npm ci`, `pnpm install`, `yarn install`, `pip install -r requirements.txt`,
  `poetry install`, `go mod download`, `cargo fetch`, `bundle install`,
  `composer install`, `dotnet restore`) — matched token-for-token, exact length.
- Commands run through `execFileSync(program, args)` with a **tokenised argument
  array**, so there is no shell and no expansion of `;`, `|`, `` ` ``, `$()`.
- File-touching actions (`create_file`, `git_add`) are confined to the project
  directory by a **path-containment check** (`path.relative` based, not a string
  prefix — see **KJC-BUG-0098**), so a crafted path cannot escape the repo.

That trio — allow-list, tokenisation, containment — is the boundary worth
reviewing. `--ignore-scripts` is not part of it.

## Why there is no built-in sandbox

Karajan does not ship its own container, seccomp profile or syscall filter, and
that is intentional.

The coder and reviewer are CLI agents (Claude, Codex, …) that the user invokes
under their **own account and permissions**. They read and write the working
tree, run the build and run the tests — that is the job. Wrapping the runtime in
a home-grown sandbox would either block that legitimate work or give a false
guarantee that is trivially bypassed by the very commands the agents must run.

Strong isolation is a **deployment concern, layered externally**: run `kj` inside
a container, a VM, a CI runner or a restricted user when you need it. That is the
right seam for it, and it composes with everything above without the runtime
pretending to enforce a boundary it cannot.

## Why there is no user-editable YAML/JSON config

Users of Karajan never hand-edit a `policy.yml`, a per-role budget file or a
stack-profile document. Configuration is expressed as **Markdown or through
natural-language wizards**, and KJ translates it into internal defaults.

- Shipped defaults + runtime auto-detection cover the common case with **zero
  files**. Fewer files beats more files.
- A YAML surface invites drift: stale keys, copy-pasted profiles, options nobody
  remembers enabling. The internal default set stays the single source of truth.
- When something genuinely needs to be chosen, it is asked conversationally, not
  delegated to a schema the user has to learn.

Internal default objects and auto-detected settings are legitimate as an
implementation detail; they are just never surfaced as a config file the user is
expected to maintain.
