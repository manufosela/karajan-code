# Template — `kj researcher`

## Cuándo usar este comando

Necesitas que Karajan **explore el codebase local** antes de codear o de planificar. El researcher devuelve un JSON con:

- `affected_files`: qué ficheros importan para la tarea
- `patterns`: convenciones que detecta en el código existente
- `constraints`: restricciones del proyecto (CLAUDE.md, AGENTS.md, etc.)
- `prior_decisions`: decisiones previas relevantes (de ADRs, CHANGELOG, comentarios)
- `risks`: trampas que ve a priori
- `test_coverage`: estado de los tests del área afectada

**No** uses esto para investigación de mercado / comparativa de stacks / búsqueda en internet. Para eso usa Claude Code o un agente con WebSearch directamente. El researcher de Karajan **NO usa WebSearch** — solo lee el filesystem del proyecto.

## Comando

```bash
kj researcher --task-file tasks/research-feature-x.task.md
```

El output sale por stdout (formato JSON o markdown según la config). No persiste a disco por sí solo — redirige con `tee` si quieres guardarlo.

## Plantilla

Copia esto a `tasks/research-<nombre>.task.md`:

```markdown
# [REPLACE: Investigar X antes de implementar Y]

## Qué voy a hacer (después de este research)

[REPLACE: 1-2 párrafos describiendo la tarea que VENDRÁ después.
EJEMPLO:
"Voy a añadir un nuevo comando `kj audit --json` que emita el report
en formato JSON parseable. Antes de codear, necesito entender cómo se
estructura el report actual y qué otros comandos ya emiten JSON."]

## Qué necesito saber

[REPLACE: lista numerada de preguntas concretas que el researcher debe responder.
EJEMPLO:
1. ¿Dónde está implementado el comando `kj audit` actual? Archivo + función principal.
2. ¿Qué otros comandos soportan `--json` y cómo lo modelan? Patrón común si lo hay.
3. ¿Hay un helper compartido para emitir JSON estructurado vs texto humano?
4. ¿Qué tests cubren actualmente `kj audit`? ¿Hay snapshot tests del output?
5. ¿Hay alguna regla en CLAUDE.md/AGENTS.md sobre formato JSON?]

## Restricciones del scope del research

[REPLACE: lista de cosas que el researcher NO debe profundizar.
EJEMPLO:
- Solo el código de `src/commands/audit/` y `src/audit/`. No tocar otros comandos.
- No leer el contenido de archivos de tests E2E (demasiado largo).
- Si encuentras commits recientes relacionados (>1 mes), reportarlos pero no analizar a fondo.]

## Output esperado

[REPLACE: cómo quieres el resultado.
EJEMPLO:
- JSON estructurado (formato default de `kj researcher`).
- Cada hallazgo con la cita `file.js:line` para verificar.
- Sección final `recommendations` con sugerencias concretas para mi tarea siguiente.]
```

## Antiejemplo (qué NO funciona)

```markdown
Investiga el mejor stack para construir un SaaS multi-tenant con GDPR,
comparando GCP/Firebase, AWS/Amplify, Supabase y Cloudflare. Incluye
precios actuales y benchmarks.
```

Problema: el researcher de Karajan NO tiene WebSearch. No puede comparar stacks ni leer precios actuales. Lo confirmará buscando en tu `node_modules` y en tu `package.json`, lo que es irrelevante. Para esa tarea usa Claude Code directamente con WebSearch + WebFetch habilitados.

## Patrón ganador (output útil)

El researcher es especialmente bueno cuando le pides:

- "Localiza dónde está implementada [feature concreta]"
- "Lista todos los archivos que importan [símbolo X]"
- "Resume las convenciones de testing del proyecto"
- "Detecta restricciones documentadas en CLAUDE.md / AGENTS.md / ADRs"
- "Identifica patterns de error handling usados en [módulo Y]"

Es decir, cualquier cosa contestable leyendo el código del proyecto.

## Encadenarlo con `kj run`

Una vez tengas el JSON del researcher, puedes pasarlo como `--context` al `kj run` siguiente para que el coder tenga ese contexto:

```bash
kj researcher --task-file tasks/research-x.task.md --json > /tmp/research.json
kj run --task-file tasks/implement-x.task.md --context "$(cat /tmp/research.json)"
```

Eso ahorra que el coder vuelva a explorar lo mismo.
