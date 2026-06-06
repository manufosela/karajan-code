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
- Manifest + trash-store primitives (KJC-TSK-0388 commit 2): self-contained
  Crockford-base32 ULID generator (`src/ulid.js`, monotonic within the same
  millisecond), manifest persistence with atomic write + `0o600` mode
  (`src/manifest.js`), and housekeeping primitives — append/list/remove by
  id, TTL expiry via `expireBefore`, and byte-budget LRU eviction via
  `enforceLruQuota`. 11 new tests covering ULID ordering, persistence
  round-trip, file permissions, entry validation, and eviction behavior.
