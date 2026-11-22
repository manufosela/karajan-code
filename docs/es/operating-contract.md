# El contrato de funcionamiento de kj

Este documento es el contrato de cómo funciona kj. Existe porque el mismo tipo de bug volvía una y otra vez desde usuarios distintos, siempre por una suposición que nadie había escrito. El mantenedor decide estas suposiciones una a una, y cada decisión se anota aquí.

La regla por encima de todas: una issue que pide lo contrario de una decisión de este contrato se cierra citándolo, sin código.

Cada decisión indica el código que la hace cumplir y el test que la prueba, de modo que el contrato nunca son solo palabras.

## Decisión 1: trabajar con personas que no usan kj

Decidida el 2026-11-21.

- Usar kj o no es elección de cada persona. Las reglas del repo obligan a todos, y la CI las hace cumplir.
- La revisión cruzada entre IAs es obligatoria para todos, y va ligada al último commit de la PR.
  - Con kj: `kj review --staged` antes de cada commit y `kj review --publish-pr` para la PR.
  - Sin kj: una revisión automática de IA en la PR, escrita por un bot que kj verifica por su login.
  - Una revisión manual o un «Approve» normal de GitHub no cuenta.
- kj solo acepta revisiones automáticas en un formato que sepa leer. Hoy ese formato es `codex-state`. Cada repo lo declara en su configuración sellada: `review: { automatic: codex-state }`.
- Hallazgos: ninguno puede estar activo.
  - Los CRITICAL y MAJOR no se pueden descartar nunca.
  - Un MINOR solo lo puede descartar alguien que no sea el autor de la PR y tenga permiso de escritura.
  - Todo hallazgo de seguridad es CRITICAL.
- Una PR que cambia `.github/workflows/` nunca cuenta con la revisión automática.

Dónde vive:

- `src/review/codex-state.js`: lee el comentario del bot de forma estricta y falla cerrando.
- `src/review/automatic-review.js`: juzga la revisión automática de una PR.
- `src/review/verify-pr.js`: la comprobación de CI, con `--automatic-review` y `--wait-automatic`.
- `src/harden/workflow-templates.js`: el workflow `kj-verdicts.yml` que siembra `kj harden`.
- La guía `apps/landing/docs/src/content/docs/guides/working-without-kj.md`.

## También decidido: una sola configuración local para todos los carriles

Decidido el 2026-11-21 (HU-4757).

La configuración local del operador (`.karajan/kj.config.yml` y `rules.local.yml`) es una sola. Cada carril la enlaza a la copia del checkout principal. No existe configuración por carril.

Dónde vive: `src/hu/lane-setup.js`, con sus tests en `tests/hu/lane-setup.test.js`.

## Decisiones 2 a 7

Pendientes, se deciden una a una.
