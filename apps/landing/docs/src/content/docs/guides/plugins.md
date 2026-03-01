---
title: Plugin System
description: Extend Karajan Code with custom agents via plugins.
---

:::note
This page is under construction. Full content coming soon.
:::

## Overview

Karajan Code supports plugins that register custom agents. Plugins are auto-discovered from:

1. **Project plugins**: `.karajan/plugins/` (in your project root)
2. **User plugins**: `$KJ_HOME/plugins/`

## Creating a Plugin

Create a `.js` file in `.karajan/plugins/` that exports a `register` function:

```javascript
export function register(api) {
  api.registerAgent({
    name: 'my-custom-agent',
    run: async ({ task, config }) => {
      // Your agent logic here
    }
  });
}
```

The plugin is auto-discovered and loaded at startup.
