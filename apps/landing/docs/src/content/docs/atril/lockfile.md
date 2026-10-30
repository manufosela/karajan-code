---
title: 'Lockfile, status and update'
description: 'The versioned lockfile, atril status for CI and atril update.'
---

<!-- synced-from: manufosela/karajan-code@2030b52dd4ffa815e271be2341d40620b8627084:packages/atril/README.md · section-sha256: 5b063968f072b8070daebcada45b598b76015dd1b221bdd1ddcd077aa41ecade
     DO NOT EDIT BY HAND — regenerated with `npm run sync:family-docs` -->

`atril.lock.json` sits in the store root (`.atril/atril.lock.json`, or under whatever `--root` or `ATRIL_ROOT` names). It records, per `kind:name`, where each installed artifact came from and a hash of its content:

```json
{
  "version": 1,
  "artifacts": {
    "skill:lint": {
      "origin": "catalog",
      "catalog": "catalogs/team.json",
      "source": "owner/repo/skills",
      "commit": "<40-character sha>",
      "hash": "sha256:<64 hex characters>"
    }
  }
}
```

- `origin` is `catalog` (installed from a catalog, with its `catalog`, and for git sources the `source` and pinned `commit`), `import` (moved in with `atril import`, with `from`) or `local` (installed from a path).
- `hash` covers the artifact's content. For a command or agent, enrichment (the `atril:` block) is not content; for a skill, every other file in its folder is.
- It holds no timestamp and no local path, and it is written deterministically, so **commit it**: the team shares one record of what is installed and from where, and diffs stay small.
- `atril install`, `atril import` and `atril update` write it; `atril remove` drops the entry. Reading never writes: a missing lockfile is an empty one, and a malformed entry fails loudly with the file and entry named.

`atril status` and `atril update` read it.

## Status

```sh
atril status                    # one line per artifact, then a summary
atril status --check            # for CI: exit 1 on edited or missing
atril status --json             # the rows as a JSON array
```

`atril status` compares the store with the lockfile. Each artifact is in one state, the first that holds:

| State | Meaning |
|---|---|
| `missing` | in the lockfile, gone from disk |
| `edited` | its content differs from the recorded hash |
| `uncurated` | not in the lockfile, or its origin is no longer a configured catalog (`local` and `import` are never curated) |
| `ok` | none of the above |

Lines are `state`, `kind:name` and the origin, separated by tabs, followed by a summary such as `3 ok, 1 edited, 0 missing, 1 uncurated`; an empty store prints `nothing installed`. With `--json` each row is `{ kind, name, state, origin }`. `--check` exits 1 only for `edited` or `missing`, so `uncurated` artifacts do not fail CI. `--root <dir>` picks the store. Status is read-only.

## Update

```sh
atril update                    # ask, per outdated artifact, whether to update it
atril update skill:lint         # only the named artifacts
atril update --yes              # apply every outdated one, skip edited ones
atril update --yes --discard-edits
atril update --json
```

`atril update` brings the artifacts installed from a catalog up to what that catalog offers now. (`atril catalog update` is the one that moves a git source's pinned commit; `atril update` then moves your copies.) It prints each pending artifact with its diff, then:

- **With a terminal**, it asks `update <kind:name>? [y/N]` for each one. For an artifact you edited locally, the question warns that the edit will be lost.
- **`--yes`** applies every outdated artifact and skips the edited ones, unless `--discard-edits` is also given, which overwrites them.
- **Without a terminal and without `--yes`**, it is a dry run: it prints the diffs, applies nothing and exits 0.
- **`--json`** prints `{ updates, applied }`: every artifact's state (`current`, `outdated`, `edited` or `unavailable`) and the refs that were updated.

An update replaces the copy atomically: if copying fails, the previous version stays. A named `kind:name` with no catalog origin in the lockfile fails before anything is applied. `atril init` reports a recommended artifact that changed in this version and tells you to run `atril update`.
