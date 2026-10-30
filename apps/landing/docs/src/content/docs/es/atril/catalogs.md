---
title: 'Catálogos y marketplaces'
description: 'Añade catálogos y marketplaces de plugins, y busca en ellos.'
---

<!-- translated-from: atril/catalogs.md · source-sha256: 7af953ee4c463ccba2b0abfed41fb634aad4527cd8e5a0820480deef06645cba -->

Un catálogo lista lo que puedes instalar sin instalarlo. Lista los catálogos en `atril.json`:

```json
{ "catalogs": ["vendor/kit", "catalogs/team.json"] }
```

Cada entrada es una carpeta con la estructura de un almacén, o un fichero JSON de fuentes git, cada una fijada a un commit y con una nota sobre para qué sirve:

```json
{
  "sources": [
    { "source": "owner/repo/skills", "commit": "<40-character sha>", "note": "process skills" }
  ]
}
```

Las fuentes usan la forma de OpenSkills `owner/repo[/path]`, interpretada como repositorios de GitHub.

```sh
atril catalog sync              # fetch every pinned source into the cache, once
atril search lint               # catalog hits come back with installed: false
atril install skill:lint        # install one, from its pinned commit
```

La descarga no ejecuta hooks, convierte los enlaces simbólicos en ficheros normales y verifica el commit. Las skills instaladas por OpenSkills en `.claude/skills` o `.agent/skills` pasan al almacén con `atril import --from openskills`.

## Marketplaces de plugins

Un catálogo también puede ser un marketplace de plugins: cualquier carpeta de catálogo que contenga `.claude-plugin/marketplace.json`, ya sea un catálogo de directorio o una fuente git fijada y descargada con `atril catalog sync`. No hay que añadir nada nuevo a `atril.json`:

```json
{ "catalogs": ["../my-marketplace"] }
```

Sus plugins se indexan a partir de los ficheros que ya están en disco, sin descargar nada ni instalar nada. Aparecen en `atril search` como `kind: plugin`, `installed: false`, con el catálogo del que proceden; `--kind plugin` lista solo esos:

```sh
atril search tdd --kind plugin
```

El primer catálogo que lista un nombre de plugin se queda con él. Una entrada de marketplace que no se puede leer se omite con un aviso en stderr; un `marketplace.json` ilegible detiene la búsqueda e indica el catálogo. `atril route` deja los plugins fuera de lo que propone. Esta versión solo encuentra plugins: su instalación llegará en una versión 5.x posterior.

## El conjunto recomendado

atril incluye un conjunto de artefactos que recomienda, empaquetado en el paquete. Es siempre el primer catálogo, antes de los de `atril.json`, así que funciona sin conexión y se versiona con atril. Nada de él se instala por sí solo:

```sh
atril recommended               # each entry: available, on-demand, persistent or changed
```

`changed` significa que el artefacto instalado difiere del que incluye esta versión de atril. `ATRIL_RECOMMENDED` apunta a atril a otro conjunto.
