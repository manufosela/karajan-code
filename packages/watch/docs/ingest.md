# Ingesta por merge (F1)

Cada merge a la rama observada de un repo dispara el workflow reusable
[`ingest.yml`](../.github/workflows/ingest.yml), que reindexa
incrementalmente el corpus compartido con karajan-rag. El embedder corre
LOCAL en el runner: el código nunca viaja a un embedder de terceros.

## Convención de workspace multi-repo

El corpus se indexa desde un workspace con **un subdirectorio por repo
observado** (`workspace/<repo>/…`): los paths quedan namespaceados por
repo y no colisionan entre repos.

El workspace debe contener **la totalidad** de los repos declarados en el config.
No es opcional: el manifest incremental de karajan-rag invalida (borra
del store) los ficheros ausentes en disco, así que indexar un workspace
parcial destruiría el corpus de los demás repos. `karajan-watch ingest`
lo verifica y falla en rojo antes de tocar nada — igual que si aparece
un directorio no declarado.

La sensibilidad declarada en el config se estampa generando el
`karajan.config.json` que karajan-rag lee en la raíz del workspace:
nivel global del corpus + una `sensitivityRule` por prefijo de repo.

## CLI

```bash
karajan-watch ingest \
  --config karajan-watch.config.json \
  --workspace .kjw-workspace \
  --corpus code   # code | docs
```

Cualquier fallo (config inválida, workspace incompleto, `PG_URL`
ausente con store pgvector, exit != 0 de karajan-rag) termina con exit
code != 0: **job rojo, nunca éxito degradado**.

## Uso desde el repo de despliegue

En el repo privado de despliegue de la organización (donde vive su
`karajan-watch.config.json`):

```yaml
# .github/workflows/reindex.yml del repo de despliegue
name: reindex
on:
  workflow_dispatch:
  repository_dispatch:
    types: [repo-merged] # cada repo observado lo emite en su push a main
jobs:
  ingest:
    uses: manufosela/karajan-watch/.github/workflows/ingest.yml@main
    with:
      org: mi-organizacion
      corpus: code
    secrets:
      REPOS_TOKEN: ${{ secrets.REPOS_TOKEN }}
      PG_URL: ${{ secrets.PG_URL_CODE }}
```

- `REPOS_TOKEN`: token con lectura de todos los repos observados.
- `PG_URL`: conexión del corpus. **Un `PG_URL` (base de datos o schema)
  por corpus**: el CLI de karajan-rag usa una tabla fija
  (`karajan_rag_chunks`), así que `code` y `docs` no pueden compartir
  base — gap upstream registrado (KJW-TSK-0003).

## Manifest incremental

El manifest (`workspace/.karajan/`) se conserva entre ejecuciones con
`actions/cache`. Si el cache se pierde, el siguiente run hace **reindex
completo**: correcto aunque lento, nunca un índice a medias. Los
despliegues que necesiten garantías más fuertes (p. ej. manifest en GCS
junto al corpus) lo resuelven en su capa de despliegue.
