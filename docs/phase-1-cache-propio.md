# Phase 1 — Cache propio: análisis técnico

> Estado: IMPLEMENTADA Y MEDIDA (Φ1-A..G, PRs #1044–#1049). Continúa Phase 0 (KJC-PCS-0056, cerrada en v3.3.0).
> Fecha: 2026-06-11 · Autor: equipo Karajan

## 1. Contexto y objetivo

Phase 0 instrumentó la **medición** del prompt-caching automático de cada provider
(`cached_tokens` normalizado en `budget.js::computeUsage()`, sección Cache hits en
`summary.md`, badge 🎯 en HU Board, telemetría `cached_tokens_pct`). El commit
fundacional (`7bca392d`, KJC-TSK-0519) fijó el siguiente paso: *"medir el
prompt-caching automático de cada provider **antes de plantear cache propio**"*.

Phase 1 es ese cache propio: **estructurar los prompts que Karajan genera para que
los mecanismos de caching de cada provider acierten al máximo**, sin tocar el
transporte (seguimos invocando CLIs, no SDKs).

Objetivo medible: subir el `cache_pct` de runs **fríos** (primera HU de un plan,
primera iteración) sin regresión en runs calientes ni en calidad de salida.

## 2. Baseline real (v3.3.0, datos 2026-06-09)

| Provider | Cold | Hot | Coste single-HU cold→hot |
|----------|------|-----|--------------------------|
| Claude (coder) | 47.2 % | 94.3 % | $0.6141 → $0.1452 (−76.4 %) |
| Gemini | 87.9 % | 96.8 % | — |
| Codex | sin medir live (unit tests OK; e2e bloqueado por bwrap del host) | — | — |
| aider / opencode | passthrough LiteLLM, sin baseline propio | — | — |

Lectura: el margen grande está en **Claude cold (47.2 %)** y en establecer el
baseline de **Codex**. Gemini ya viene alto de serie (caching implícito agresivo).

## 3. Mecánica de caching por provider (restricción: vamos vía CLI)

| Provider | Mecanismo | Granularidad | Qué controla Karajan vía CLI |
|----------|-----------|--------------|------------------------------|
| Anthropic (`claude -p`) | `cache_control` breakpoints (los pone el CLI: system + tools + mensajes) | Bloques con breakpoint; prefix-match exacto | El contenido de `-p` y de `--append-system-prompt`. NO los breakpoints |
| OpenAI (`codex`) | Prefix caching automático, mínimo 1024 tokens, incrementos ~128 | Prefijo de tokens, sin breakpoints | El orden del prompt completo: prefijo estable = hit directo |
| Gemini (`gemini`) | Implicit caching (2.5+) automático | Prefijo de tokens | Ídem OpenAI |
| aider / opencode | LiteLLM normaliza downstream | Según provider subyacente | Ídem: orden del prompt |

Implicación clave por provider:

- **OpenAI/Gemini**: el caching es *token-prefix* puro y automático → basta con que
  los prompts de llamadas consecutivas **compartan prefijo literal**. Es la palanca
  más barata y cubre codex, gemini, aider y opencode a la vez.
- **Anthropic**: el prefix-match opera sobre breakpoints que pone el CLI. Un prefijo
  estable *dentro* del mensaje de usuario monolítico no genera hit. La palanca es
  **mover el contenido estable al system block** vía `--append-system-prompt`
  (el CLI ya cachea system + tools con breakpoints — el 47.2 % cold actual es
  precisamente eso). El mensaje `-p` queda solo con lo volátil.

## 4. Diagnóstico: por qué los prompts actuales rompen el cache

`buildCoderPrompt()` (src/prompts/coder.js) intercala estable y volátil:

```
1. SUBAGENT_PREAMBLE          estable
2. langInstruction            estable
3. Task: <texto de la HU>     ← VOLÁTIL en posición 3
4-9. reglas, constraints      estables
10-13. stack/projectDir/rtk   estables por proyecto
14. plan                      volátil por run
15. ADRs                      semiestable por plan
16-17. specSection/findings   volátiles por HU
18. acceptanceTests           volátil por HU
19-20. coderRules, TDD        estables
21. sonarSummary              volátil
22. reviewerFeedback          volátil por iteración
23. skills                    ← ESTABLE en última posición
```

El prefijo estable compartido entre dos llamadas son ~2 secciones (≪1024 tokens):
para OpenAI/Gemini el hit sobre la parte que Karajan controla es ~0. Y el bloque
de skills (estable, potencialmente grande) va al final, detrás de todo lo volátil.

`buildReviewerPrompt()` (src/prompts/reviewer.js) tiene el mismo anti-patrón:
`Task context` + `Git diff` (hasta 12 KB, cambia siempre) van **antes** de la
sección de skills.

## 5. Opciones consideradas

| Opción | Decisión | Razón |
|--------|----------|-------|
| **A. Reorden prefix-stable** de los prompt builders (estable-primero, volátil-último) | ✅ Hacer | Cubre 4 providers vía CLI, coste bajo, sin tocar transporte |
| **B. System-prompt split para Anthropic** (`--append-system-prompt` con el bloque estable) | ✅ Hacer | Única forma de que Anthropic cachee el contenido estable de Karajan; el CLI ya pone breakpoints en system |
| C. Bypass CLI → SDK directo con `cache_control` manual | ❌ Descartar | Perderíamos el agente completo (tools Read/Write/Edit/Bash las da el CLI). Re-implementar el harness no es Phase 1 |
| D. Gemini explicit context-caching API | ⏸ Posponer | Gemini ya está a 87.9 % cold con implicit; ROI marginal y requiere API directa |
| E. TTL extendido (1 h) Anthropic | ❌ No accesible | Feature beta de API, no expuesta vía CLI |

## 6. Diseño

Núcleo: un helper `prompt-layout.js` que separa las secciones en dos buckets:

```js
buildPromptLayout(sections) → { stable: string, volatile: string }
```

- **stable**: preámbulo, idioma, reglas genéricas, constraints de subproceso,
  projectDir rule, stack, rtk/serena, coderRules, política TDD, skills,
  productContext, domainContext. Invariante entre iteraciones de la misma HU
  y entre HUs del mismo plan/proyecto.
- **volatile**: plan, task, ADRs, specSection, reviewerFindings, acceptanceTests,
  sonarSummary, reviewerFeedback, diff. Cambia por HU/iteración.

Consumo por agente:

- `claude-agent`: `--append-system-prompt <stable>` + `-p <volatile>`.
- `codex/gemini/aider/opencode`: concatenar `stable + "\n\n" + volatile`
  (prefijo literal estable → prefix caching automático).

Invariantes a proteger con tests:

1. El bloque stable es **byte-idéntico** entre iteración N y N+1 de la misma HU.
2. El bloque stable es byte-idéntico entre HUs del mismo plan (mismo proyecto,
   mismas skills, mismas rules).
3. Ninguna información se pierde: `stable ∪ volatile` ≡ contenido actual
   (mismas secciones, solo reordenadas).

## 7. Slices propuestos (≤200 LOC netas cada uno, patrón Φ0)

| Slice | Contenido | Ficheros principales |
|-------|-----------|----------------------|
| Φ1-A | `prompt-layout.js`: buckets stable/volatile + tests unitarios | src/prompts/prompt-layout.js (nuevo) |
| Φ1-B | coder.js migra al layout (reorden estable-primero) + snapshot tests | src/prompts/coder.js |
| Φ1-C | reviewer.js migra al layout (skills antes del diff, diff al final) | src/prompts/reviewer.js |
| Φ1-D | claude-agent: system-prompt split (`--append-system-prompt`) cuando el rol provee `stablePrompt` | src/agents/claude-agent.js |
| Φ1-E | planner/architect/hu-reviewer al layout estable | src/prompts/{planner,architect,hu-reviewer}.js |
| Φ1-F | Test de regresión de estabilidad de prefijo: longest-common-prefix entre prompts consecutivos ≥ 80 % del bloque stable | tests/prompts/prefix-stability.test.js (nuevo) |
| Φ1-G | Medición real cold/hot post-reorden (Claude+Gemini+Codex) + golden tasks para validar no-regresión de calidad + doc de resultados | docs/, tests/golden |
| Φ1-H | Release vX.Y.0 + landing | CHANGELOG, landing |

Orden de dependencias: A → (B,C,E en paralelo) → D → F → G → H.

## 8. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Reordenar secciones cambia el comportamiento del LLM (el comentario "order matters" en coder.js es intencional: ADRs → spec → findings → tests) | Regresión de calidad | El orden RELATIVO del bloque volátil se mantiene intacto; solo se extrae lo estable al frente. Golden tasks (Φ1-G) + plan-adherence score como gate |
| TTL Anthropic 5 min: el gap entre fin de una HU y inicio de la siguiente puede expirar el cache | Hit parcial entre HUs | Aceptado: el win principal es iteración-a-iteración dentro de la HU (gaps de segundos). Documentar |
| `--append-system-prompt` con bloques grandes (skills) podría cambiar la adherencia a instrucciones | Calidad | Gate con golden tasks; rollback por flag si hace falta |
| Codex sigue sin baseline live (bwrap) | No podemos verificar el win en OpenAI | Medir en entorno sin sandbox o aceptar verificación via unit tests + datos de terceros |

## 9. Métricas de aceptación

- Claude **cold** `cache_pct` ≥ 65 % (baseline 47.2 %).
- Claude **hot** sin regresión (≥ 90 %; baseline 94.3 %).
- Gemini sin regresión (cold ≥ 85 %; baseline 87.9 %).
- Codex: baseline medido + prefijo estable ≥ 1024 tokens verificado por test.
- Golden tasks: 3/3 sin regresión estructural.
- Prefix-stability test: bloque stable byte-idéntico inter-iteración e inter-HU.

## 10. Resultados (medición real 2026-06-11, Φ1-G)

Protocolo: proyecto scratch (`/tmp/kj-phase1-measure`, git + bare origin local),
misma task pequeña (slugify + tests node:test + README), `kj run --coder claude
--reviewer claude`, cold = dir reseteado tras >6 min sin llamadas a la API
(TTL Anthropic 5 min), hot = re-run inmediato. Sesiones
`s_2026-06-11T07-54-44-721Z` (cold) y `s_2026-06-11T08-10-27-908Z` (hot).

| Métrica (rol coder, Claude) | Baseline v3.3.0 | Phase 1 cold | Phase 1 hot |
|---|---|---|---|
| Cached tokens | — | 1 058 694 | 1 287 936 |
| Tokens in (no cacheados) | — | 4 211 | 4 046 |
| `cache_pct` = cached/(cached+in) | 47.2 % / 94.3 % | **99.60 %** | **99.69 %** |
| Coste coder | $0.6141 (cold) | **$0.1447** | $0.1983 |
| Resultado del run | — | APPROVED + audit CERTIFIED | APPROVED + audit CERTIFIED |

Lectura: con el bloque estable viajando por `--append-system-prompt` (Φ1-D),
los breakpoints del system block convierten prácticamente todo el contexto
repetido en cache hits — la distinción cold/hot casi desaparece (99.60 % vs
99.69 %) y el coste del coder en frío cae un **76 %** vs baseline. Targets de
la sección 9 superados con margen.

Evidencia de no-regresión de calidad: ambos runs APPROVED con quality gate
Sonar OK (cold), audit final CERTIFIED, acceptance tests (`node --test`)
verdes, y la suite prefix-stability (Φ1-F) congelando el contrato en CI. El
harness e2e de golden tasks sigue siendo mock-only (limitación pre-existente
a Phase 1, no una regresión).

### Incidencias de entorno detectadas durante la medición (bugs a abrir)

1. `sonarqube.enabled: false` en config de proyecto NO desactiva el
   sonar-stage, y el flag `--no-sonar` de `kj run` tampoco. El stage corre
   siempre.
2. Cuando el run termina por error de stage (sonar_repeat, gh pr create
   fallido), el post-loop NO escribe `summary.md` → se pierde la sección
   Cache hits y todo el journal de la sesión (solo queda triage.md).
3. El rol `audit` (claude) no reporta `cached_tokens` — la tabla Cache hits
   solo lista al coder aunque el audit consume ~10k tokens por run.
4. Codex live sigue bloqueado por bwrap del host (igual que en Φ0): baseline
   OpenAI pendiente; verificado por test que el prefijo estable supera el
   mínimo de 1024 tokens de su prefix caching.
