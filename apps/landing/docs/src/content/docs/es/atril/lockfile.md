---
title: 'Lockfile, status y update'
description: 'El lockfile versionado, atril status para CI y atril update.'
---

<!-- translated-from: atril/lockfile.md · source-sha256: 5b063968f072b8070daebcada45b598b76015dd1b221bdd1ddcd077aa41ecade -->

`atril.lock.json` está en la raíz del almacén (`.atril/atril.lock.json`, o bajo la ruta que indiquen `--root` o `ATRIL_ROOT`). Registra, por cada `kind:name`, de dónde vino cada artefacto instalado y un hash de su contenido:

```json
{
  "version": 1,
  "artifacts": {
    "skill:lint": {
      "origin": "catalog",
      "catalog": "catalogs/team.json",
      "source": "owner/repo/skills",
      "commit": "<40-character sha>",
      "hash": "sha256:<64 hex characters>"
    }
  }
}
```

- `origin` es `catalog` (instalado desde un catálogo, con su `catalog` y, en las fuentes git, el `source` y el `commit` fijado), `import` (traído con `atril import`, con `from`) o `local` (instalado desde una ruta).
- `hash` cubre el contenido del artefacto. En un comando o agente, el enriquecimiento (el bloque `atril:`) no es contenido; en una skill, sí lo es cualquier otro fichero de su carpeta.
- No contiene marcas de tiempo ni rutas locales y se escribe de forma determinista, así que **haz commit de él**: el equipo comparte un único registro de lo que está instalado y de dónde viene, y los diffs se mantienen pequeños.
- `atril install`, `atril import` y `atril update` lo escriben; `atril remove` elimina la entrada. Leer nunca escribe: un lockfile ausente equivale a uno vacío, y una entrada mal formada falla de forma explícita indicando el fichero y la entrada.

`atril status` y `atril update` lo leen.

## Status

```sh
atril status                    # one line per artifact, then a summary
atril status --check            # for CI: exit 1 on edited or missing
atril status --json             # the rows as a JSON array
```

`atril status` compara el almacén con el lockfile. Cada artefacto está en un único estado, el primero que se cumpla:

| Estado | Significado |
|---|---|
| `missing` | está en el lockfile y ya no existe en disco |
| `edited` | su contenido difiere del hash registrado |
| `uncurated` | no está en el lockfile, o su origen ya no es un catálogo configurado (`local` e `import` nunca se consideran curados) |
| `ok` | ninguno de los anteriores |

Las líneas son `state`, `kind:name` y el origen, separados por tabuladores, seguidas de un resumen como `3 ok, 1 edited, 0 missing, 1 uncurated`; un almacén vacío imprime `nothing installed`. Con `--json` cada fila es `{ kind, name, state, origin }`. `--check` sale con código 1 solo para `edited` o `missing`, así que los artefactos `uncurated` no hacen fallar el CI. `--root <dir>` elige el almacén. Status es de solo lectura.

## Update

```sh
atril update                    # ask, per outdated artifact, whether to update it
atril update skill:lint         # only the named artifacts
atril update --yes              # apply every outdated one, skip edited ones
atril update --yes --discard-edits
atril update --json
```

`atril update` actualiza los artefactos instalados desde un catálogo a lo que ese catálogo ofrece ahora. (`atril catalog update` es el que mueve el commit fijado de una fuente git; `atril update` mueve después tus copias.) Imprime cada artefacto pendiente con su diff y después:

- **Con terminal**, pregunta `update <kind:name>? [y/N]` por cada uno. Si editaste el artefacto localmente, la pregunta avisa de que esa edición se perderá.
- **`--yes`** aplica todos los artefactos desactualizados y omite los editados, salvo que se indique también `--discard-edits`, que los sobrescribe.
- **Sin terminal y sin `--yes`**, es una ejecución en seco: imprime los diffs, no aplica nada y sale con 0.
- **`--json`** imprime `{ updates, applied }`: el estado de cada artefacto (`current`, `outdated`, `edited` o `unavailable`) y las referencias que se actualizaron.

Una actualización reemplaza la copia de forma atómica: si falla la copia, se conserva la versión anterior. Un `kind:name` indicado que no tenga origen de catálogo en el lockfile falla antes de aplicar nada. `atril init` informa de un artefacto recomendado que cambió en esta versión y te indica que ejecutes `atril update`.
