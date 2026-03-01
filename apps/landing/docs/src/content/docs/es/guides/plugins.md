---
title: Sistema de Plugins
description: Extiende Karajan Code con agentes custom via plugins.
---

:::note
Esta página está en construcción. Contenido completo próximamente.
:::

## Visión General

Karajan Code soporta plugins que registran agentes custom. Los plugins se auto-descubren desde:

1. **Plugins de proyecto**: `.karajan/plugins/` (en la raíz del proyecto)
2. **Plugins de usuario**: `$KJ_HOME/plugins/`

## Crear un Plugin

Crea un fichero `.js` en `.karajan/plugins/` que exporte una función `register`:

```javascript
export function register(api) {
  api.registerAgent({
    name: 'mi-agente-custom',
    run: async ({ task, config }) => {
      // Tu lógica de agente aquí
    }
  });
}
```

El plugin se auto-descubre y carga al iniciar.
