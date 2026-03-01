---
title: Corregir un Bug
description: Ejemplo de workflow para corregir un bug con Karajan Code.
---

:::note
Esta página está en construcción. Contenido completo próximamente.
:::

```bash
kj run "Corregir vulnerabilidad de inyección SQL en el endpoint de búsqueda" \
  --coder claude \
  --reviewer codex \
  --enable-security \
  --methodology tdd
```
