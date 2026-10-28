---
title: 'Find, install and remove'
description: 'Search the catalogs, install artifacts into the store and remove them.'
---

<!-- synced-from: manufosela/karajan-code@1f93ff844b77afbffd1f2683c35ff657f103286d:packages/atril/README.md · section-sha256: 44363e6f7a2eefe3d700bf2c8cad1df805620841a3ee775fcc223fa6b2f172ef
     DO NOT EDIT BY HAND — regenerated with `npm run sync:family-docs` -->

```sh
atril scan                      # what the stores hold
atril search "flaky test"       # ranked hits, installed and available
atril route "fix the flaky login test" --role coder
```

`atril route` resolves a task into a **block**: the best artifact plus what it `uses` (and the agents it `delegates` to, as subagents), ordered so each piece comes after what it depends on, within a budget. It prints the files to read, not their content. `atril enrich` completes each artifact's frontmatter with the relations it discovers, and `atril graph` shows them.

## Install and remove

```sh
atril install ./my-skill        # a local skill folder, command or agent file
atril install skill:lint        # an artifact a catalog offers (see below)
atril remove command:review
```

An install is validated first, refuses symlinks, and never overwrites different content.
