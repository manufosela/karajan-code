# Spike: rulesync hooks and MCP coverage, and byte stability of its output

Card HU-3864 · answers a request in issue #3847 · rulesync 43.1.2

## Question

Hooks do not go through rulesync today: they are the sealed supervisor, and a
generated hook would skip the seal. The proposal in #3847 is to seal the
**source** (`.rulesync/`) and the **hash** of what rulesync generates for each
agent, and let the Sentinel and CI regenerate with the same pinned version and
compare. The maintainer asked for a spike that proves, for each agent kj
supports, that:

- (a) rulesync generates hooks for it, and
- (b) the same version and the same input give the same bytes.

Also open: whether rulesync generates MCP for Google Antigravity CLI (the
README row could not be read from the page text).

Agents: Claude Code, Codex CLI, Google Antigravity CLI, OpenCode.

## Method

Facts below come only from the measurements of this spike.

| Item | Value |
| --- | --- |
| rulesync | `43.1.2` (exists on npm; the version named in the issue) |
| tarball integrity (`package-lock.json`) | `sha512-W1YYWI3sPVUZ/tiKy2mC2Epgu352IKF2QGvBrUSbeQ8EeTo2V0csZK9ELvra+3RHwmdVT1/PoPjMhKe3Gn+dXQ==` |
| Node | `v24.22.0` |
| OS | macOS (Darwin 25.6.0) |
| Target names (from the README/`generate --help` of 43.1.2) | `claudecode`, `codexcli`, `antigravity-cli`, `opencode` (also `opencodev1`, see below) |

Safety rules used (the package is downloaded code, treated as untrusted):

- Everything ran in a fresh directory outside any repository (`$SPIKE`), with
  no script of this repo run in it.
- Exact version, `--ignore-scripts`, never `npx` at latest.
- Clean environment for every run: `env -i PATH=<node>:/usr/bin:/bin HOME=<dir>`
  (no token, no secret).

Repeat it:

```sh
SPIKE=$(mktemp -d)                      # outside any repo
cat > "$SPIKE/package.json" <<'EOF'
{ "name": "rulesync-spike", "private": true, "version": "0.0.0",
  "dependencies": { "rulesync": "43.1.2" } }
EOF
npm install --prefix "$SPIKE" --ignore-scripts --no-audit --no-fund
grep -A3 '"node_modules/rulesync"' "$SPIKE/package-lock.json"   # integrity
RS="$SPIKE/node_modules/.bin/rulesync"; "$RS" --version
```

Source (`.rulesync/`) in a git-initialised project: one root rule
(`rules/overview.md`), one MCP server in `mcp.json`
(`{"mcpServers":{"spike-server":{"command":"echo","args":["never-started"]}}}`,
never started) and `hooks.jsonc` with one hook per canonical event of 43.1.2,
each `{ "type": "command", "command": "echo spike-<event>" }`. The 54 canonical
events are the `HOOK_EVENTS` array of the bundle (`dist/import-*.js`), from
`sessionStart` to `postModelSwitch`.

Per target and per feature set (`hooks`, `mcp`, `hooks,mcp`):

```sh
cd "$PROJECT" && env -i PATH="$NODE_BIN:/usr/bin:/bin" HOME="$HOME_DIR" \
  "$RS" generate --targets <target> --features <hooks|mcp|hooks,mcp>
```

Byte stability, three runs of every combination, each in a fresh copy:

| Run | Directory | `HOME` | When |
| --- | --- | --- | --- |
| A | `P1/<combo>` | `P1/<combo>.home` | t0 |
| B | same absolute paths as A (A's tree moved away first) | same | a few minutes after A |
| C | a different directory name, `P2/<combo>` | different | 75 s after B (clock changed) |

Every generated file was compared A-B and A-C with `cmp` and
`shasum -a 256`, together with the list of files written.

## Results

All 15 combinations (5 targets x 3 feature sets) exited 0. No target refused
`hooks` or `mcp` ("not supported for this target" never appeared).

| Agent (target) | hooks generated | mcp generated | byte-identical A/B/C | Files written (project scope) |
| --- | --- | --- | --- | --- |
| Claude Code (`claudecode`) | yes, 33 of 54 events | yes | **yes** | `.claude/settings.json`, `.mcp.json` |
| Codex CLI (`codexcli`) | yes, 14 of 54 events | yes | **yes** | `.codex/hooks.json`, `.codex/config.toml` |
| Google Antigravity CLI (`antigravity-cli`) | yes, 6 of 54 events | **yes** | **yes** | `.agents/hooks.json`, `.agents/mcp_config.json` |
| OpenCode (`opencode`, OpenCode 2.x) | yes, 15 of 54 events, as a JS plugin | yes | **yes** | `.opencode/plugins/rulesync-hooks.js`, `opencode.jsonc` |
| OpenCode V1 (`opencodev1`, extra) | yes, 18 of 54 events, as a JS plugin | yes | **yes** | same paths, different content |

What varies: nothing. For every file and every pair (A-B, A-C) `cmp` reported
identical bytes and the file lists were identical. A search of all outputs for
absolute paths (`/private`, `/Users`, `/tmp`), dates, `generated`, `timestamp`
or `uuid` found no match, so no clock, path or random value leaks in this
setup. The directory, `HOME` and a 75 s clock change made no difference.

SHA-256 of the files (identical in A, B and C):

| File | SHA-256 |
| --- | --- |
| `claudecode` `.claude/settings.json` | `72fd637f05a6e81e2aed27f706a8f46be6a3a3654809824e2f8d1e848f2ccce7` |
| `claudecode` `.mcp.json` | `f827d7e3af90e8ad2a191cff52bec9d0e7a6130a4e0dd72339ad2e98d4ebf03d` |
| `codexcli` `.codex/hooks.json` | `0b4e6b4c5de605508079f98dbdeb1f8a4958c321e918f7caf673d2a0950531cf` |
| `codexcli` `.codex/config.toml` | `080a5253ca1abb378ff4461c2268af0ae68633d340a0ea60995d2e5b1d3f78b3` |
| `antigravity-cli` `.agents/hooks.json` | `e743af6d628e9fe513cfc98cdabebfd9df2b93b544a91415507aef883d93bc9d` |
| `antigravity-cli` `.agents/mcp_config.json` | `f827d7e3af90e8ad2a191cff52bec9d0e7a6130a4e0dd72339ad2e98d4ebf03d` |
| `opencode` `.opencode/plugins/rulesync-hooks.js` | `001c2c9695a46913683dec6603648127aa47d8c4e138e0c5b5e0a5251bc448b3` |
| `opencode` `opencode.jsonc` | `1e073657ee587bd4d0d4a714bdd8491cd783761cbcc5727e9626e918d4e8d8d2` |
| `opencodev1` `.opencode/plugins/rulesync-hooks.js` | `d695ae5fe376bbb54c191da07b7ff4b0bae7ed4b574de764e1fe9a9352b2c44f` |
| `opencodev1` `opencode.jsonc` | `11acbe407e5911601d049188e49286b90674ce976cb6f74b549ffa87de4da406` |

(The Claude Code and Antigravity MCP files have the same content, hence the
same hash.)

Event coverage, literal from the generate log: events the target does not
support are **skipped with a `Skipped hook event(s) for <target> (not
supported): ...` warning and exit code 0**. The 6 events Antigravity CLI keeps
are `sessionStart`, `preToolUse`, `postToolUse`, `preModelInvocation`,
`postModelInvocation`, `stop`; the file is written under a top-level
`"rulesync"` key in `.agents/hooks.json`.

MCP for Google Antigravity CLI: **yes**. `generate --targets antigravity-cli
--features mcp` writes `.agents/mcp_config.json`, and the 43.1.2 README row for
"Google Antigravity CLI" has mcp and hooks ticked (it now reads cleanly from
the packaged README).

## What rulesync adds beyond the generated files

Measured on a project seeded with hand-written files (a Claude `Stop` hook and
`permissions`, an MCP server `hand` in each agent's MCP file, a `model` key in
Codex's `config.toml`, a `theme` key in `opencode.jsonc`, a hand-written
`.opencode/plugins/mine.js`, a `README.md`), generating all four targets with
`hooks,mcp`, twice:

- **Default mode: whole-file rewrite of the files it generates, no ledger.** In
  `.claude/settings.json`, `.codex/hooks.json` and `.agents/hooks.json` the
  hand-written `Stop` hook was **dropped**; the hand-written MCP server `hand`
  was dropped from `.mcp.json`, `.codex/config.toml`, `.agents/mcp_config.json`
  and `opencode.jsonc`. Keys it does not manage survived (`permissions` in the
  Claude file, `model` in `config.toml`, `theme` in `opencode.jsonc`).
  `README.md` and `mine.js` were untouched. No marker such as
  `mcp:<server>` or `hooks:<event>:<id>` was written. `HOME` stayed empty
  and `.rulesync/` was not modified. A second run changed nothing.
- **With `{"preserveUnownedHooks": true}` in `rulesync.jsonc`:** the hand `Stop`
  hook survived in Claude and Codex (the log says `Preserving unowned hook on
  Stop`) and rulesync adds two **ledger files**, `.claude/.rulesync-hooks-lock.json`
  and `.codex/.rulesync-hooks-lock.json` (`lockfileVersion`, then the `owned`
  list of `{event, matcher, identity}`). Antigravity's hand hook was still
  dropped (the option covers Claude Code, Codex CLI, Cursor and Qwen Code per
  the packaged docs). MCP servers were still replaced in all four.

`generate --check` exits 1 when a generated file differs from what it would
write ("Files are not up to date") and 0 otherwise. It reported the
fresh tree up to date, flagged an edited hook command, and a plain `generate`
repaired it. `--dry-run` writes nothing. `--check` exits 0 even when it prints
the "Skipped hook event(s)" warning.

## Verdict

**Part (a) holds for all four agents; part (b) holds for all four, in a clean
generation, for the pinned version, in this environment.** With the same
version and the same input, every generated file was byte-identical across a
repeated run, a different directory and `HOME`, and a different clock.
The sealed-hash idea is viable for hooks on Claude Code, Codex CLI, Antigravity
CLI and OpenCode, with these conditions:

1. **Pin the version and the Node version in the seal** (version plus the
   integrity hash of the tarball). Two targets (`opencode`, `opencodev1`) emit
   different bytes for the same input, so a target name is part of the contract.
2. **Hash the hooks subtree, not the whole file.** Claude's `settings.json`,
   Codex's `config.toml` and `opencode.jsonc` also hold keys rulesync does not
   own (`permissions`, `model`, `theme`). A whole-file hash would break
   whenever a person edits another key. The seal needs to normalise: extract
   `hooks` (Claude `settings.json`, `.codex/hooks.json`, the `rulesync` key of
   `.agents/hooks.json`) or hash the dedicated file (`rulesync-hooks.js`).
3. **Fail on skipped events.** An event a target does not support is skipped
   with exit 0, so a hook sealed in the source can silently not exist for an
   agent (only 6 of 54 events reach Antigravity CLI). The check must compare
   the list of events written, not just the hash.
4. **Do not use default mode in a repo with hand-written hooks or MCP
   servers:** it overwrites them without a trace. Either all hooks live in
   `.rulesync/` (and the sealed regenerate is the only writer), or
   `preserveUnownedHooks` is on, which adds lock files that also need sealing
   or ignoring.
5. **MCP:** supported and stable for all four, but regenerating replaces other
   hand-written servers in the same file.

## What was NOT verified

- That the agents actually load and run the generated files (only the bytes
  were checked). In particular the `rulesync` key of Antigravity's
  `.agents/hooks.json` and OpenCode's `mcp.servers` layout in `opencode.jsonc`
  were not tried against the real products.
- Other operating systems, other Node versions, other rulesync versions,
  Windows line endings. One machine, one version, one Node.
- `--global` scope; only project scope.
- Hook commands that start with `./` (rulesync prefixes them with a project
  variable for some targets), matchers, timeouts and other hook options. Only
  `command` hooks without a path were used.
- Rules, subagents, skills, commands, permissions: not generated here.
- An end-to-end run of the proposed flow (Sentinel and CI regenerating and
  comparing); `kj` was not involved.
- Stability across an input that changes only in key order or whitespace.

## Resumen en español

Se instaló rulesync 43.1.2 (versión exacta, `--ignore-scripts`, entorno limpio,
fuera de cualquier repo) y se generó `hooks` y `mcp` para Claude Code, Codex CLI,
Antigravity CLI y OpenCode. Los cuatro generan hooks (33, 14, 6 y 15 de 54
eventos canónicos; el resto se omite con aviso y código de salida 0) y los
cuatro generan MCP, también Antigravity CLI (`.agents/mcp_config.json`). Con la
misma versión y la misma entrada, todos los ficheros salieron idénticos byte a
byte en tres ejecuciones (mismo directorio, otro directorio y `HOME`, y 75 s
después); no se filtra ruta, fecha ni valor aleatorio. Veredicto: el sello del
hash es viable para hooks en los cuatro agentes si se fija la versión y el hash
del paquete, se sella solo el subárbol de hooks (los ficheros contienen
claves ajenas), se falla cuando se omite un evento y no se usa el modo por
defecto con hooks o servidores MCP escritos a mano (los sobrescribe sin
rastro). No se verificó que los agentes ejecuten los ficheros, otros SO/Node,
el modo `--global` ni el flujo completo del Sentinel y CI.
