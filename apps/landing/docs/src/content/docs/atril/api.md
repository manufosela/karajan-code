---
title: 'Programmatic API'
description: 'The exports of @karajan-family/atril.'
---

<!-- synced-from: manufosela/karajan-code@2030b52dd4ffa815e271be2341d40620b8627084:packages/atril/README.md · section-sha256: b287b40fb2168e30b7fdabbf3bf4d289306f09c20ad215b139741649865f4c98
     DO NOT EDIT BY HAND — regenerated with `npm run sync:family-docs` -->

```js
import { search, resolve, install, sync, catalogSync } from "@karajan-family/atril";

const { block, available } = resolve({ task: "fix the flaky login test", role: "coder", root: ".atril" });
```

The entry exports `search`, `resolve`, `resolveBlock`, `install`, `remove`, `status`, `expose`, `unexpose`, `persistentPieces`, `sync`, `generate`, `catalogSync`, `catalogUpdates`, `applyCatalogUpdate`, `installFromCatalog`, `importSkills`, `recommended`, `applyRecommended`, `detectPluginFormat`, `listPluginMarkdown`, `readPluginManifest`, `MARKER` and `VERSION`.

`status({ root })` returns the rows `atril status --json` prints. `search` returns marketplace plugins as hits of kind `plugin`; `plugins: false` leaves them out.

## License

MIT
