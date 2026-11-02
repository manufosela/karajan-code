---
title: 'API programática'
description: 'Las exportaciones de @karajan-family/atril.'
---

<!-- translated-from: atril/api.md · source-sha256: b287b40fb2168e30b7fdabbf3bf4d289306f09c20ad215b139741649865f4c98 -->

```js
import { search, resolve, install, sync, catalogSync } from "@karajan-family/atril";

const { block, available } = resolve({ task: "fix the flaky login test", role: "coder", root: ".atril" });
```

El punto de entrada exporta `search`, `resolve`, `resolveBlock`, `install`, `remove`, `status`, `expose`, `unexpose`, `persistentPieces`, `sync`, `generate`, `catalogSync`, `catalogUpdates`, `applyCatalogUpdate`, `installFromCatalog`, `importSkills`, `recommended`, `applyRecommended`, `detectPluginFormat`, `listPluginMarkdown`, `readPluginManifest`, `MARKER` y `VERSION`.

`status({ root })` devuelve las filas que imprime `atril status --json`. `search` devuelve los plugins de marketplace como resultados de tipo `plugin`; `plugins: false` los excluye.

## Licencia

MIT
