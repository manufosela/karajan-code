# `kj start` — entrada del squad autónomo (análisis técnico)

> Estado: ANÁLISIS. Épica KJC-PCS-0061 (Brain-orchestrated onboarding). Reajusta las cards Onboard A/B/C (0568/0569/0570). Depende de `harden --report` (KJC-TSK-0566, épica advisory KJC-PCS-0060).
> Fecha: 2026-06-14 · Autor: equipo Karajan

## 1. Objetivo

Un único comando, **`kj start`**, como entrada del "squad": el usuario expresa intención y, como mucho, la **madurez** del proyecto. Karajan hace el resto — evalúa en read-only qué hay, decide el siguiente paso con una **capa IA barata (haiku)** y propone/ejecuta con confirmación. **El usuario no conoce ni invoca `doctor`/`check`/`harden`/`onboard`/`rag`/`qmd`**: el Brain los orquesta.

## 2. Principio rector: **decisor, no ejecutor suelto**

La capa IA **decide el QUÉ** (un intent de un conjunto cerrado); el **CÓMO seguro** lo deciden las piezas deterministas. El LLM nunca ejecuta comandos a su aire: elige un intent estructurado y KJ lo mapea a un **comando guardado existente**, con **confirmación para todo lo que escribe**. Coherente con "guardarraíles deterministas, el pipeline manda".

## 3. Madurez del proyecto (cambia qué se propone)

| Tipo | Señales (deterministas) | Énfasis de la propuesta |
|---|---|---|
| **nuevo** | repo vacío o solo scaffolding (`create-*`), sin historia real | confirmar stack, andamiaje, harden desde cero, indexar, plan inicial |
| **existente** | código + config + tests + CI, commits recientes | cómo contribuir + mejoras de harness **no rompedoras** |
| **legacy** | código real pero descuidado: sin tests/CI, deps viejas, commits parados | assessment + audit + **plan de modernización** incremental |

Legacy ≠ antiguo: es **salud/mantenimiento**. La madurez se **infiere y se confirma** con el usuario (no se pregunta en seco).

## 4. Flujo (4 fases; la evaluación SIEMPRE read-only)

```
kj start [intención en NL opcional]
 ├─ Fase 0 · Asegurar KJ configurado
 │    └─ si no hay kj.config → init mínimo (escribe SOLO .karajan/, nunca el código del usuario)
 │       en existente/legacy: init --no-harden (harden queda como propuesta, no automático)
 ├─ Fase 1 · Evaluar (READ-ONLY, no toca el árbol del usuario)
 │    ├─ infiere madurez y la confirma
 │    └─ barrido por madurez (todo no-destructivo): doctor · onboard (brief→~/.karajan/) ·
 │       harden --report · check · rag/qmd status · (legacy: + audit)
 ├─ Fase 2 · Bundle de señales → síntesis (rol onboarder/architect, modelo fuerte)
 └─ Fase 3 · DECISOR (rol, haiku) → {intent, rationale, questionToAsk?}
      ├─ recomienda algo → "Te propongo X porque Y. ¿Lo hago? [s/n]"
      ├─ necesita intención → UNA pregunta abierta → respuesta NL → reenruta
      └─ ejecuta el intent vía comando guardado, confirmando lo que escribe
```

**Invariante de seguridad**: Fase 1 no escribe en el árbol del usuario (harden/scaffold/index viven en Fase 3, con OK explícito). La config de KJ (`.karajan/`) sí puede escribirse en Fase 0 — es config de KJ, no código del usuario.

## 5. El rol decisor (`StartDecidorRole`)

Extiende **`AgentRole`** (`src/roles/agent-role.js`) replicando el patrón de **`TriageRole`** / **`KarajanBrainRole`**:

- **Modelo**: `resolveRole(config, "start")` (`src/config/role-resolver.js`); default **haiku** (`roles.start.model: claude-haiku-4-5-…`). Barato/rápido = ideal para enrutar. Fallback a `roles.coder`.
- **Entrada**: `{ userMessage?, assessment }` (la síntesis + bundle de Fase 1/2).
- **`buildPrompt`**: preamble + el assessment + el **esquema cerrado de intents** embebido (estilo `buildTriagePrompt`).
- **`parseOutput`**: `extractFirstJson(raw)` (`src/utils/json-extract.js`).
- **`buildSuccessResult`**: valida `intent ∈ INTENTS` (como `normalizeRoles` valida contra `VALID_ROLES`); si inválido o null → `ASK_USER` (degradación segura vía `handleParseNull`).
- Se ejecuta con **`withBrainRecovery`** (`src/brain/with-brain-recovery.js`) para cuota/red, igual que `discoverCommand`.

### Esquema cerrado de intents → comando guardado

| intent | Significado | Ejecuta (con confirmación si escribe) |
|---|---|---|
| `ASSESS_ONLY` | solo informe | imprime assessment, sale |
| `RECOMMEND_HARDEN` | hay gaps de calidad | `kj harden --interactive` (advisory, adoptar/dejar por pieza) |
| `RECOMMEND_INDEX` | codebase sin indexar | `kj rag index` + registrar QMD |
| `START_TASK` | el usuario quiere desarrollar algo | `kj run` / `kj plan` con la tarea |
| `PROPOSE_PLAN` | legacy/grande | `kj plan` (modernización o feature) |
| `ASK_USER` | falta intención | una pregunta abierta → realimenta al decisor |

El decisor **enruta**; cada destino es un comando que ya tiene sus guards.

## 6. La evaluación read-only (qué reutiliza, sin reinventar)

| Señal | Reutiliza | Escribe en el árbol del usuario |
|---|---|---|
| Entorno | `doctor` (`--check-only`) | no |
| Brief del codebase | `kj onboard` collectors (`collectAll`) + OnboarderRole | no (brief → `~/.karajan/onboarding/`) |
| Gaps de calidad | `harden --report` (advisory, KJC-TSK-0566) | no |
| Deriva del andamiaje | `kj check` | no |
| Conocimiento | `rag status` / `qmd status` | no |
| (legacy) salud profunda | `kj audit` (read-only) | no |

El **bundle de señales** (estructura serializable) es lo que consume la síntesis y el decisor.

## 7. Modos

- **Interactivo** (default): infiere madurez + confirma; decisor propone o hace una pregunta; ejecuta con confirmación.
- **`--json` / sin TTY / `--yes`**: hace el barrido read-only y emite el **assessment + intent recomendado**, sin preguntar ni aplicar nada (CI, o "solo dime qué hay").
- **Re-ejecución**: barata; reusa el brief cacheado, recalcula gaps.

## 8. Frontera con comandos existentes

- `kj init` = configurar el runtime de KJ. `kj start` lo **usa** (Fase 0), no lo reemplaza.
- `kj onboard` = brief de codebase. `kj start` lo **invoca** como una señal más; sigue existiendo standalone.
- **Superficie para el usuario**: `kj start` + los básicos (`run`/`code`/`plan`). El resto (`doctor`/`check`/`harden`/`onboard`/`rag`/`qmd`) quedan como internos orquestados.

## 9. Reuso (módulos reales)

`AgentRole` + `extractFirstJson` + `resolveRole` + `withBrainRecovery` (patrón de `discoverCommand`) + `TriageRole`/`KarajanBrainRole` como plantilla del decisor + `onboard collectAll` + `harden --report` + `check` + `doctor`. Nada de `claude -p` crudo: el modelo, guards, coste y fallback los hereda del motor de roles.

## 10. Slices (reajuste de las cards de KJC-PCS-0061)

| Slice | Card | Contenido |
|---|---|---|
| Onboard A | 0568 | Clasificador de madurez + **orquestador del barrido read-only** → bundle de señales |
| Onboard B | 0569 | Síntesis (rol) + **`StartDecidorRole`** (haiku, schema de intents) → `{intent, rationale, questionToAsk}` |
| Onboard C | 0570 | **`kj start`**: loop contexto→decisor→confirmar→ejecutar comando guardado; modos interactivo/`--json`/`--yes` |

Orden: A (señales) → B (síntesis + decisor) → C (comando + loop). Depende de `harden --report` (0566).

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| El LLM "decide" algo destructivo | Decisor solo emite intent de un set cerrado; ejecución vía comandos guardados + confirmación; Fase 1 read-only por construcción |
| Salida del LLM no parseable | `extractFirstJson` + validación de intent + fallback `ASK_USER` (degradación, nunca crash) |
| Coste/latencia | haiku para decidir (barato/rápido); síntesis pesada solo cuando aporta; presupuesto vía BudgetTracker heredado del rol |
| Inferencia de madurez errónea | siempre se **confirma** con el usuario antes del barrido |
| Indeterminismo del LLM en el control | el LLM enruta, no controla; el flujo y los guards son deterministas |

## 12. Métricas de aceptación

- `kj start` en repo nuevo / existente / legacy → infiere y confirma madurez, corre solo señales read-only (verificable: `git status` limpio tras Fase 1), y propone un intent coherente.
- Ningún comando interno visible al usuario; `--json`/`--yes` no preguntan ni escriben.
- El decisor nunca crashea ante salida basura (cae a `ASK_USER`).
- Cada intent enruta a un comando existente con sus guards; nada que escriba se aplica sin confirmación.
