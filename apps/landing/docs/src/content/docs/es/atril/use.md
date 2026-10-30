---
title: 'Buscar, instalar y eliminar'
description: 'Busca en los catálogos, instala artefactos en el almacén y elimínalos.'
---

<!-- translated-from: atril/use.md · source-sha256: 44363e6f7a2eefe3d700bf2c8cad1df805620841a3ee775fcc223fa6b2f172ef -->

```sh
atril scan                      # what the stores hold
atril search "flaky test"       # ranked hits, installed and available
atril route "fix the flaky login test" --role coder
```

`atril route` convierte una tarea en un **bloque**: el mejor artefacto más lo que `uses` (y los agentes a los que `delegates`, como subagentes), ordenados de modo que cada pieza venga después de aquello de lo que depende, dentro de un presupuesto. Imprime los ficheros que hay que leer, no su contenido. `atril enrich` completa el frontmatter de cada artefacto con las relaciones que descubre, y `atril graph` las muestra.

## Instalar y eliminar

```sh
atril install ./my-skill        # a local skill folder, command or agent file
atril install skill:lint        # an artifact a catalog offers (see below)
atril remove command:review
```

Una instalación se valida primero, rechaza los enlaces simbólicos y nunca sobrescribe contenido distinto.
