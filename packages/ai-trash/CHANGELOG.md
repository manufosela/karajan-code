# Changelog — @karajan/ai-trash

All notable changes to this package are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Skeleton package (KJC-TSK-0388 commit 1): `package.json` (`@karajan/ai-trash`,
  private bin `kj-trash`), README with roadmap, `bin/kj-trash.js` stub that
  prints a "not implemented yet" banner, `src/index.js` placeholder, smoke
  test confirming the package can be required and lists its `kj-trash` bin.
- Self-contained Crockford-base32 ULID generator (`src/ulid.js`,
  KJC-TSK-0388 commit 2a): time-prefix gives lexicographic sortability and
  the 80-bit random suffix is bumped by one within the same millisecond so
  two back-to-back snapshots keep a stable order. No runtime dep — fewer
  transitive surfaces under the trash store. `decodeTimeFromUlid` rebuilds
  the timestamp for diagnostics.
- Manifest record-keeping primitives (`src/manifest.js`, KJC-TSK-0388
  commit 2b): atomic load/save (tmp + rename, `0o600` mode, schemaVersion
  gate), `addEntry`/`listEntries`/`removeEntry` CRUD, TTL drop via
  `expireBefore`, and byte-budget LRU eviction via `enforceLruQuota`.
  Real filesystem snapshots still land in commit 4.
- Audit log + permission helpers (`src/logger.js` + `src/permissions.js`,
  KJC-TSK-0388 commit 3): append-only JSONL audit log under
  `<root>/log.jsonl` with `$HOME` redaction on path-shaped fields,
  `ensureSecureDir` (chmod 0o700), `lockdownFile` (chmod 0o600), and
  `assertOwnedByCurrentUser` to detect a hijacked root directory.
- Filesystem snapshotter (`src/snapshot.js`, KJC-TSK-0388 commit 4):
  `snapshotFile` copies the source into `<root>/store/<ulid>/<basename>`
  with 0o600 mode, returns a manifest-ready entry, and audits the event.
  `restoreSnapshot` refuses to clobber an existing path. `purgeSnapshot`
  removes the snapshot dir and audits the eviction. Directories are out
  of scope for the MVP — file-only.
- `kj-trash` CLI surface (`src/cli.js` + bin, KJC-TSK-0388 commit 5):
  subcommands `list` (id/age/bytes/source table), `inspect <id>` (JSON
  payload), and `restore <id> [--to PATH]` (atomic restore + manifest
  drop). Root defaults to `~/.ai-trash` (override via `AI_TRASH_ROOT`)
  and is hardened with `ensureSecureDir` + `assertOwnedByCurrentUser`.
- `kj-trash empty` and `kj-trash purge <id>` (KJC-TSK-0388 commit 6):
  `purge` removes a single snapshot (store dir + manifest entry);
  `empty` drops every snapshot by default, with `--older-than-days N`
  (TTL sweep via `expireBefore`) and `--max-bytes N` (LRU eviction via
  `enforceLruQuota`) filters. Each removal is audited.
- Destructive-command parser (`src/destructive-parser.js`,
  KJC-TSK-0390 commit 1): pure classifier the upcoming PreToolUse hook
  feeds Bash commands into. Recognises `rm` / `rm -rf`, `truncate`,
  `> file` redirect clobbers, `mv`/`cp` overwrite candidates, and the
  destructive corners of `git` (`reset --hard`, `clean -f`,
  `branch -D`, `push --force`, `checkout -- <path>`). Conservative by
  design: anything not proven safe is reported as destructive so the
  hook fails closed.
- End-to-end smoke (`tests/e2e.test.js`, KJC-TSK-0388 commit 7): drives the
  full pipeline against a sandbox root — programmatic `snapshotFile`, then
  `runCli` through `list` → `inspect` → `restore --to` → re-snapshot →
  `empty`, asserting filesystem side-effects on each hop and that the JSONL
  audit log captured the four expected events
  (`snapshot.create`, `snapshot.restore`, `snapshot.create`, `snapshot.purge`)
  with no unredacted `$HOME`-prefixed paths leaking through.
