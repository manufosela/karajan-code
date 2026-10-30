---
title: 'Catalogs and marketplaces'
description: 'Add catalogs and plugin marketplaces, and search across them.'
---

<!-- synced-from: manufosela/karajan-code@2030b52dd4ffa815e271be2341d40620b8627084:packages/atril/README.md · section-sha256: 7af953ee4c463ccba2b0abfed41fb634aad4527cd8e5a0820480deef06645cba
     DO NOT EDIT BY HAND — regenerated with `npm run sync:family-docs` -->

A catalog lists what you can install without installing it. List catalogs in `atril.json`:

```json
{ "catalogs": ["vendor/kit", "catalogs/team.json"] }
```

Each entry is either a folder in a store's layout, or a JSON file of git sources, each pinned to a commit with a note on what it is for:

```json
{
  "sources": [
    { "source": "owner/repo/skills", "commit": "<40-character sha>", "note": "process skills" }
  ]
}
```

Sources use the OpenSkills form `owner/repo[/path]`, read as GitHub repositories.

```sh
atril catalog sync              # fetch every pinned source into the cache, once
atril search lint               # catalog hits come back with installed: false
atril install skill:lint        # install one, from its pinned commit
```

The fetch runs no hooks, lands symlinks as plain files and verifies the commit. Skills installed by OpenSkills into `.claude/skills` or `.agent/skills` move into the store with `atril import --from openskills`.

## Marketplaces of plugins

A catalog can also be a plugin marketplace: any catalog folder that holds `.claude-plugin/marketplace.json`, either a directory catalog or a git source pinned and fetched with `atril catalog sync`. Nothing new goes in `atril.json`:

```json
{ "catalogs": ["../my-marketplace"] }
```

Its plugins are indexed from the files already on disk, with no fetch and nothing installed. They show up in `atril search` as `kind: plugin`, `installed: false`, with the catalog they come from; `--kind plugin` lists only them:

```sh
atril search tdd --kind plugin
```

The first catalog that lists a plugin name wins it. A marketplace entry that cannot be read is skipped with a warning on stderr; an unreadable `marketplace.json` stops the search and names the catalog. `atril route` leaves plugins out of what it proposes. This release only finds plugins: installing them arrives in a later 5.x release.

## The recommended set

atril ships a set of artifacts it recommends, bundled in the package. It is always the first catalog, before the ones in `atril.json`, so it works offline and versions with atril. Nothing in it is installed on its own:

```sh
atril recommended               # each entry: available, on-demand, persistent or changed
```

`changed` means the installed artifact differs from the one this version of atril ships. `ATRIL_RECOMMENDED` points atril at another set.
