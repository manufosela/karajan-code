# Karajan — Charla: Code Walkthrough (6 snippets)

> Material **interno** de preparación de charla. NO se publica en `/docs/` (vive fuera del directorio de Starlight). Cada snippet está verificado contra el código de `karajan-code` en la fecha de creación.
>
> **Repo source:** `~/ws_npm-packages/karajan-code/`
> **Click-paths:** los `file:line-line` son clicables desde VS Code (`Ctrl+P` → pega la ruta).

---

## Cómo usar este documento

1. Antes de la charla: abre los 6 ficheros en pestañas separadas, con la línea inicial visible. Tener todo precargado evita el "espera, dónde estaba…".
2. Para cada slide: lee el **mensaje narrativo** (no el código). El código está para que la audiencia *vea* la idea, no para leerla en voz alta.
3. **Tiempo total de la sección de código: ~8 min.** Si vas justo, sacrifica primero el #6 (cierra bien pero el #5 ya entrega el mensaje deterministic-first).

---

## 1️⃣ El loop como negociación multi-señal

**Slide title:** *"Cada iteración pasa por 5+ árbitros, no por un retry."*
**Fichero:** `src/orchestrator/drivers/iteration-loop.js:1-22`
**Tiempo sugerido:** 90s

### Código a mostrar

```javascript
/**
 * Iteration-loop driver — extracted from src/orchestrator/flow-runner.js
 * in TSK-0335 (Oleada 3 of the v2.7.4 audit refactor).
 *
 * Everything inside the coder→reviewer loop:
 *
 *   - runCoderAndRefactorerStages: coder (+ refactorer if enabled), with
 *                                  standby handling per stage.
 *   - runGuardStages:              deterministic output/perf guards on the diff.
 *   - runQualityGateStages:        TDD check, Sonar (local + cloud), Impeccable.
 *   - runReviewerGateStage:        reviewer role, with standby handling.
 *   - handleApprovedReview:        wire post-loop stages + finalize session.
 *   - runSingleIteration:          one coder→reviewer cycle (the iteration body).
 *   - runIterationLoop:            the while loop, checkpoints, budget/time
 *                                  gates, error recovery via Solomon,
 *                                  max-iterations extension path.
 */
```

### Mensaje narrativo

La forma naíf de orquestar un agente es "pídele código, ship". Karajan enmarca cada iteración como una **negociación**: el coder propone, los guards deterministas vetan en reglas duras (filesystem leaks, credenciales), Sonar añade verdad externa, el TDD gate impone "tests fail-first", el reviewer evalúa estructuralmente, y Solomon arbitra si discrepan.

Esto es **por qué** un límite de 5 iteraciones converge tan a menudo: cada iteración tiene múltiples señales independientes diciéndole al coder qué arreglar, en vez de un único "try again".

**Frase para soltar:** *"No hago retry. Hago negociación."*

---

## 2️⃣ Diseño guiado por contenido, no por flags

**Slide title:** *"La forma del input ES la señal. No hay `--use-canvas`."*
**Fichero:** `src/cli/register-plan.js:53-61`
**Tiempo sugerido:** 60s

### Código a mostrar

```javascript
// REASONS Canvas auto-detection: a SPEC that contains
// `## REASONS:Section` headings is treated as a structured
// Canvas — parsed + validated BEFORE the planner runs. This
// catches broken acceptance tests (jq syntax, bash parse,
// gherkin missing Given/Then, the 2026-04-29 as-binding
// misuse class) at plan-time, without spending LLM dollars.
//
// Detection by file CONTENTS, not by CLI flag — the Canvas
// format is the signal of intent.
if (typeof resolvedTask === "string" && /^##\s+REASONS:/m.test(resolvedTask)) {
```

### Mensaje narrativo

Una decisión de diseño completa en 3 líneas de código. Quien escribió el formato Canvas no tiene que aprender un flag; quien escribió spec plana no paga peaje. **El formato es la señal de intención.** Es el principio "make the safe thing automatic" llevado al extremo: detectar por *contenido*, no por *flag*.

Validar en plan-time, no en run-time, es el bonus: un test de aceptación roto cazado aquí cuesta cero; el mismo test cazado en la iteración 3 ya quemó al coder y al reviewer en tres rondas.

**Frase para soltar:** *"Si tu spec tiene esa cabecera, sabe que la quieres tratar en serio."*

---

## 3️⃣ Errores como taxonomía declarativa

**Slide title:** *"Brain Recovery: cada clase de error tiene política, no `try/catch`."*
**Fichero:** `src/brain/with-brain-recovery.js:17-34`
**Tiempo sugerido:** 90s

### Código a mostrar

```javascript
export const DEFAULT_RECOVERY_POLICY = Object.freeze({
  hibernateThresholdMs: 5 * ONE_MIN, // > 5 min de espera → hibernar
  longStandbyCapMs: 10 * ONE_MIN,    // si el caller no hiberna, espera máx 10 min
  fallbackWaitHoursDefault: DEFAULT_FALLBACK_WAIT_HOURS,
  classes: {
    [ERROR_CLASS.RATE_LIMIT_SHORT]:        { mode: "standby",   maxRetries: 3 },
    [ERROR_CLASS.QUOTA_EXHAUSTED_DAILY]:   { mode: "hibernate", maxRetries: 1, fallbackEligible: true },
    [ERROR_CLASS.QUOTA_EXHAUSTED_MONTHLY]: { mode: "hibernate", maxRetries: 1, fallbackEligible: true },
    [ERROR_CLASS.API_DOWN]:                { mode: "backoff",   maxRetries: 3, baseMs: 5_000, factor: 3, jitterPct: 0.2 },
    [ERROR_CLASS.NETWORK_TIMEOUT]:         { mode: "backoff",   maxRetries: 3, baseMs: 5_000, factor: 3, jitterPct: 0.2 },
    [ERROR_CLASS.SILENCED]:                { mode: "backoff",   maxRetries: 2, baseMs: 30_000, factor: 2, jitterPct: 0.15 },
    [ERROR_CLASS.AUTH_FAILED]:             { mode: "abort",     maxRetries: 0 },
    [ERROR_CLASS.UNKNOWN_FATAL]:           { mode: "abort",     maxRetries: 0 },
  },
});
```

### Mensaje narrativo

Una **tabla**, no spaghetti de `if/else` repartido por 12 ficheros. Cada clase de error vista en la naturaleza (rate-limit corto, agotamiento diario/mensual, API caída, timeout, agente silenciado, auth roto) tiene su **respuesta declarada**: standby corto, backoff exponencial con jitter, hibernación a disco, o aborto.

El que ha sufrido un rate-limit a las 3am durante un build largo lo entiende en 5 segundos. Y conecta directamente con `kj standby` — la sesión congelada por `QUOTA_EXHAUSTED_DAILY` se descongela mañana y continúa donde se quedó. **El límite es temporal, el trabajo no.**

**Frase para soltar:** *"Cuando Anthropic me ratela, no pierdo el run. Lo congelo."*

---

## 4️⃣ Arquitectura impuesta como invariante en el código

**Slide title:** *"La arquitectura no está en un diagrama. Está en un comentario que el audit hace cumplir."*
**Fichero:** `src/orchestrator/solomon-escalation.js:11-21`
**Tiempo sugerido:** 90s

### Código a mostrar

```javascript
/**
 * Architectural invariant (DO NOT BREAK):
 * `invokeSolomon` MUST NOT be called directly from stages, rules or agent
 * code. The only callers should be:
 *   - Karajan Brain (via `src/brain/solomon-consult.js`)
 *   - The orchestrator's escalation path (`src/orchestrator/flow-runner.js`)
 *     on behalf of Brain.
 * The v2.3.0 audit fixed 21 violations of this rule. Keeping Solomon behind
 * Brain is what the "Brain-as-gateway, Solomon-as-judge" architecture
 * depends on — see docs/ARCHITECTURE.md §Brain/Solomon.
 */
```

### Mensaje narrativo

El patrón **Brain-gateway + Solomon-judge** en 8 líneas. Brain decide; Solomon arbitra solo cuando Brain le consulta. Nada llama a Solomon directo.

Lo importante de este snippet **no es la regla, es la última frase**: *"The v2.3.0 audit fixed 21 violations of this rule."* La arquitectura **no es una aspiración** — es algo que el audit cuenta y arregla. Honestidad técnica → credibilidad.

**Frase para soltar:** *"Tuvimos 21 violaciones de esto. El audit las cazó. Ahora son cero."*

---

## 5️⃣ Calidad medida en duro, sin tokens

**Slide title:** *"Plan adherence: 0–100, determinista, reproducible."*
**Fichero:** `src/audit/plan-adherence.js:1-15`
**Tiempo sugerido:** 60s

### Código a mostrar

```javascript
/**
 * Plan adherence metric — KJC-TSK-0376 (deepeval-inspired).
 * Pure offline 0-100 score: how faithfully did the coder follow the plan?
 * Components (weighted): commit_attribution 40%, acceptance_tests 30%,
 * scope_discipline 20%, dependency_order 10%. Components return null
 * when no data; aggregator redistributes the weight.
 */

const WEIGHTS = {
  commit_attribution: 40,
  acceptance_tests: 30,
  scope_discipline: 20,
  dependency_order: 10,
};
```

### Mensaje narrativo

No es el LLM diciendo "creo que la iteración fue buena". **Es código contando commits, contando acceptance tests pasando, midiendo si los cambios se quedaron dentro del scope declarado, comprobando si las HUs corrieron en el orden de sus dependencias.** Cuatro componentes, pesos explícitos, suman 100. Si no hay datos para uno, redistribuye el peso.

Es la diferencia entre **"AI vibes"** y **"AI engineering"**.

**Frase para soltar:** *"Si quieres saber si la IA hizo bien su trabajo, no le preguntes a la IA. Mide."*

---

## 6️⃣ Las herramientas hablan, la IA razona

**Slide title:** *"Sonar / OSV / Semgrep no son post-checks. Son contexto del prompt."*
**Fichero:** `src/prompts/audit.js:48-66` **+** `src/prompts/audit.js:229-245`
**Tiempo sugerido:** 90s

### Código a mostrar (parte A — stack-aware filtering)

```javascript
if (stack && (stack.frameworks?.length > 0 || stack.language)) {
  const stackLines = ["## Project Stack"];
  if (stack.language)       stackLines.push(`- Language: ${stack.language}`);
  if (stack.frameworks?.length) stackLines.push(`- Frameworks: ${stack.frameworks.join(", ")}`);
  // ...
  if (stack.isBackend) {
    stackLines.push("This project is backend-only. SKIP findings about " +
      "bundle size, lazy loading, render-blocking resources, image " +
      "optimisation, and frontend accessibility. Focus on queries, " +
      "sync I/O, pagination, caching, auth/authz, and dependency hygiene.");
  }
}
```

### Código a mostrar (parte B — Sonar findings injection)

```javascript
if (sonarFindings?.available && (sonarFindings.total > 0 || sonarFindings.qualityGate)) {
  const lines = ["## SonarQube Findings"];
  if (sonarFindings.qualityGate?.status) {
    lines.push(`- Quality gate: ${sonarFindings.qualityGate.status}`);
  }
  if (sonarFindings.total > 0) {
    lines.push(`- Total open issues: ${sonarFindings.total}`);
    const groups = groupIssuesBySeverity(sonarFindings.issues);
    for (const [severity, issues] of Object.entries(groups)) {
      // ... groups Sonar findings into the LLM's prompt as ground truth
    }
  }
}
```

### Mensaje narrativo

**Cierra el círculo.** No es "LLM con plugins" ni "LLM con post-procesador". Es: el detector de stack le dice al modelo *"este proyecto es backend, SALTA frontend"*. Sonar le da hallazgos *exactos* (fichero, línea, regla). OSV le da CVEs *confirmados* por versión instalada. Semgrep le da SAST. Todo eso **entra como contexto del prompt**.

El modelo no especula sobre dead exports — los lee de knip. No adivina CVEs — los lee de OSV. **Las herramientas son la verdad de base, la IA razona sobre ella.**

**Frase para soltar:** *"La mayoría usan LLM-wrapping you. Yo uso LLM-orchestrating tools."*

---

## Resumen ejecutivo

| # | File:line | Slide title | Mensaje | Tiempo |
|---|-----------|-------------|---------|--------|
| 1 | `src/orchestrator/drivers/iteration-loop.js:1-22` | "5+ árbitros por iteración, no retry" | Loop = negociación multi-señal | 90s |
| 2 | `src/cli/register-plan.js:53-61` | "La forma del input ES la señal" | Diseño por contenido, no por flag | 60s |
| 3 | `src/brain/with-brain-recovery.js:17-34` | "Errores con política, no try/catch" | Taxonomía declarativa de errores | 90s |
| 4 | `src/orchestrator/solomon-escalation.js:11-21` | "Invariante en el código, no en diagrama" | Brain-gateway + Solomon-judge | 90s |
| 5 | `src/audit/plan-adherence.js:1-15` | "0–100, determinista" | Calidad medida en duro, sin tokens | 60s |
| 6 | `src/prompts/audit.js:48-66 + :229-245` | "Herramientas hablan, IA razona" | Hechos primero, juicio LLM después | 90s |

**Total:** ~8 minutos. Resto de la charla: setup conceptual + demo en vivo + Q&A.

---

## Lo que NO mostraría (guardar para Q&A)

- **`src/agents/claude-agent.js`** — el `cleanExecaOpts()` / `pickOutput()` hack para Claude Code 2.x como subprocess. Bug-story, no idea de diseño. Si alguien pregunta "qué fue lo más difícil", suéltalo entonces.
- **El cuerpo de `iteration-loop.js`** (301 líneas). El JSDoc cabecera ya entrega el mensaje.
- **Skills system** (`addyosmani/agent-skills` integration). Interesante pero requiere 5 min de setup conceptual antes de que el código signifique algo. Para charla larga sí; para 40-60min, no.
- **El árbol de roles** (`src/roles/*-role.js`). 24 ficheros. La idea ya está en el #1 (el loop) y el #4 (Brain/Solomon).

---

## Setup pre-charla (checklist 30 min antes)

1. Terminal en `~/ws_npm-packages/karajan-code/`, pantalla limpia.
2. VS Code con los **6 ficheros abiertos en pestañas** en este orden:
   ```
   src/orchestrator/drivers/iteration-loop.js
   src/cli/register-plan.js
   src/brain/with-brain-recovery.js
   src/orchestrator/solomon-escalation.js
   src/audit/plan-adherence.js
   src/prompts/audit.js
   ```
3. Cada fichero centrado en su **línea inicial**:
   - iteration-loop.js → línea 1
   - register-plan.js → línea 53
   - with-brain-recovery.js → línea 17
   - solomon-escalation.js → línea 11
   - plan-adherence.js → línea 1
   - prompts/audit.js → línea 48 (para parte A; cambiar a 229 para parte B)
4. **Tamaño de fuente VS Code: 18-20pt** para proyector. Verificar de pie a 3-4m de la pantalla.
5. **Tema claro** (high-contrast en proyector). Olvidar el dark mode bonito — el público no lo ve.
6. Terminal con `kj run` listo en otra pestaña para la demo (independiente de esta sección de código).
7. Sin notificaciones (Slack, Mail, etc.).

---

## Frase de cierre para la sección de código

> *"Karajan no es un LLM wrapper. Es la **infraestructura** que hace que un LLM **sea fiable como herramienta de ingeniería**, no como generador de adivinanzas plausibles. Las herramientas hablan, la IA razona, y todo lo importante se mide."*

Pausa. Pasas a la demo en vivo.
