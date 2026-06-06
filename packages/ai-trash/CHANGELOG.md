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
