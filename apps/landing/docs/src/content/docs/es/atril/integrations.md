---
title: 'rulesync y servidor MCP'
description: 'Piezas persistentes mediante rulesync y el servidor MCP de atril.'
---

<!-- translated-from: atril/integrations.md · source-sha256: 6d4ab0511acef9c7d082f75a2de9b49af6f7291fd39dee1f57c90e338b6b879e -->

Los CLI solo aceptan los slash commands que conocen. atril registra **uno** en cada CLI, el puente `/atril <name or task>`, además de una regla de enrutado que indica al agente que consulte a atril antes de una tarea. Todo lo demás sigue bajo demanda, salvo que decidas exponerlo de forma permanente:

```sh
atril expose command:review     # recorded in atril.json
atril sync                      # write the bridge, the rule and the exposed artifacts
atril sync --check              # for CI: exit 1 while .rulesync/ is out of date
```

`atril sync` escribe en las fuentes de [rulesync](https://github.com/dyoshikawa/rulesync) (`.rulesync/`), y solo se adueña de lo que escribió, mediante el registro de propiedad de rulesync: una edición manual, un fichero tuyo o una entrada de otro escritor lo detienen sin cambiar nada. Con `"rulesync": { "generate": true }` en `atril.json`, ejecuta después `rulesync generate`, que reparte las piezas a todos los CLI.

## Servidor MCP

```sh
atril mcp --root .atril
```

Sirve `search`, `resolve`, `install` y `remove` como herramientas MCP por stdio. El almacén se fija al arrancar el servidor; una llamada a una herramienta nunca lo elige.
