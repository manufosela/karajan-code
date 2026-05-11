# Template — `kj run`

## Cuándo usar este comando

Tienes una tarea concreta (un bug fix, una mejora pequeña, una HU suelta) que el coder puede atacar directamente. **No** uses esto para features grandes que necesitan descomposición — para eso usa `kj plan generate` y luego `kj run --plan <id>`.

## Comandos

```bash
# Forma corta — tarea como argumento
kj run "Add JSDoc comments to src/utils/format.js explaining each exported function"

# Forma extendida — task file (recomendado para tareas con contexto)
kj run --task-file tasks/fix-bug-042.task.md

# Plan completo — ejecuta cada HU en cadena
kj run --plan plan-<id>
```

## Plantilla para task file individual

Copia esto a `tasks/<descripcion>.task.md` y rellena:

```markdown
# [REPLACE: Título corto de la tarea]

## Contexto

[REPLACE: 1-3 párrafos describiendo:
 - Qué hay actualmente en el código
 - Qué problema vas a resolver
 - Por qué importa]

## Cambio que quiero

[REPLACE: descripción concreta del cambio, en prosa.
EJEMPLO:
"Añadir un argumento opcional `--dry-run` al comando `kj clean` que
imprima qué se borraría sin tocar nada. Cuando el flag está
presente, los `fs.rmSync` deben sustituirse por `console.log` del
path. Tests de regresión que verifiquen ambos modos."]

## Restricciones técnicas

[REPLACE: lista de cosas que NO se deben tocar.
EJEMPLO:
- NO romper la API pública de `cleanCommand({ dryRun, ... })`.
- Mantener compatibilidad con el config flag `clean.dryRun` existente.
- ≤200 LOC de delta (rule del repo, KJC-TSK-0352).]

## Criterios de aceptación

[REPLACE: 3-8 condiciones verificables.
EJEMPLO:
1. `kj clean --dry-run` imprime cada path que se eliminaría, prefijado con "[dry-run]".
2. `kj clean --dry-run` sale con exit code 0 sin tocar nada en disco.
3. `kj clean` sin `--dry-run` mantiene el comportamiento actual exacto.
4. Nuevo test `tests/clean-dry-run.test.js` cubre los 3 casos.
5. Todos los tests existentes siguen pasando.]

## Archivos esperados a tocar

[OPTIONAL — solo si tú lo sabes. Si no, el coder lo decide.
EJEMPLO:
- `src/commands/clean.js`
- `tests/clean-dry-run.test.js` (NEW)]

## Notas técnicas

[OPTIONAL. EJEMPLO:
- El config flag `clean.dryRun` ya existe en `src/config/schema.js`; reusarlo si el usuario no pasa el CLI flag.
- El comando tiene un test existente en `tests/command-clean.test.js`; usar el mismo pattern (vi.mock de fs.rmSync).]
```

## Reglas que el coder respetará por defecto (no las repitas)

Karajan ya inyecta en el coder estas reglas globales, así que NO tienes que repetirlas:

- ≤200 LOC por PR (KJC-TSK-0352).
- Conventional Commits.
- Tests obligatorios cuando hay cambio de lógica.
- TDD (red→green→refactor) salvo que la tarea sea solo refactor/docs.
- No `Co-Authored-By` ni atribuciones a IA en commits.
- Idioma del código en inglés; PR/commit messages en el idioma del proyecto.

Si necesitas **saltar** alguna de estas reglas, dilo explícitamente:

```markdown
## Excepciones a las reglas globales

- Esta PR excede 200 LOC porque [razón]. Aplicar label `large-pr-justified`.
- No hay tests porque [razón].
```

## Antiejemplo (qué NO funciona)

```markdown
Build a complete authentication system with login, signup, password recovery,
OAuth Google/Microsoft, magic-link, profile management, and account deletion.
```

Problema: eso son 8-12 HUs, no una tarea. El coder o se desboca y produce un mega-commit, o se queda corto. Usa `kj plan generate` para una feature así.

## Verificación

Tras `kj run`, Karajan deja:

- Commit en una rama nueva `feat/<slug>-<timestamp>` (o `fix/...`).
- PR abierta si tienes `auto_pr: true` en config.
- Journal en `.reviews/session_<id>/` con `summary.md`, `iterations.md`, `decisions.md`, `tree.txt`.

Si el run termina como `REJECTED` o `PAUSED`, lee `summary.md` para entender por qué.
