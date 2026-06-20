# Autonomous Delivery — de spec a software funcionando, sin intervención humana

> Estado: ANÁLISIS / DISEÑO. Épica **KJC-PCS-0062**. Cards AUTO-A..F (KJC-TSK-0572..0577).
> Construye sobre el Brain (`kj start`, KJC-PCS-0061) y recoge el viejo "Solomon as boss" (KJC-PCS-0017).
> Fecha: 2026-06-20 · Autor: equipo Karajan

## 1. Objetivo

El **summum** de Karajan: dada una **spec de proyecto**, hace el plan, crea las HUs y **arranca solo hasta terminar**, con confianza plena en sus capacidades y **sin intervención humana**. Tres principios irrenunciables:

1. **Autonomía**: spec → plan → HUs → ejecutar hasta el final, sin pasos manuales ni gates que pidan input humano.
2. **Autoridad de decisión**: cuando hay **conflicto entre agentes** (reviewer vs coder, tester vs coder, spec ambigua, criterio de aceptación que no pasa tras N iteraciones), Karajan **decide él mismo** la opción **menos mala** y sigue.
3. **Cumplir lo pedido, no la perfección**: el resultado, aunque tenga defectos, debe **cumplir el encargo**. Los defectos residuales se **registran y se informan**, no bloquean la entrega.

## 2. Principio rector: decisor con autoridad, ejecución guardada

La capa autónoma **decide el QUÉ** (un intent/veredicto de un conjunto cerrado); el **CÓMO seguro** lo deciden las piezas deterministas (el pipeline manda, igual que en `kj start`). La diferencia con el modo interactivo de hoy es una sola: **donde hoy el pipeline pregunta a un humano, en modo autónomo pregunta al Arbiter** — que devuelve siempre una decisión válida, nunca `null`, nunca un bloqueo indefinido.

Filosofía operativa: **"perfecta-antes-de-público" no aplica al run autónomo; aplica al producto**. Un run autónomo busca *cumplir el encargo con la menor deuda posible*, deja traza de cada compromiso, y nunca se cuelga esperando a un humano.

## 3. Estado actual y hueco (verificado en código, 2026-06-20)

El **núcleo ya existe**. Esta épica añade el **pegamento de autonomía**, no capacidades nuevas de fondo.

| Capacidad | Ya existe | Módulo |
|---|---|---|
| spec/tarea → HUs (con AC + grafo de deps + auto-fix de ciclos) | ✅ | `src/commands/plan/generate.js` |
| Ejecutar TODAS las HUs en orden topológico | ✅ | `src/orchestrator/hu-sub-pipeline.js`, `src/orchestrator/drivers/run-hu-batch.js` |
| Fallo de HU → bloquea dependientes y continúa | ✅ | `hu-sub-pipeline.js` (`blockDependents`) |
| Recuperación sin humano (standby/backoff/fallback/hibernate) | ✅ | `src/brain/with-brain-recovery.js`, `standby-store.js`, `standby-scheduler.js` |
| Patrón de rol-decisor barato (haiku, schema cerrado) | ✅ | `src/roles/agent-role.js` + TriageRole/KarajanBrainRole, `resolveRole` |

**Hueco (lo que corta la autonomía total):**

| # | Gate que bloquea | Hoy en `--yes` / no-TTY | Módulo |
|---|---|---|---|
| G1 | spec-review con spec ambigua | **aborta** (`proceed:false`) | `src/spec-review/run-spec-review.js` |
| G2 | una stage (reviewer/coder) pregunta algo | `askQuestion`→`null`→**aborta la HU** | `src/utils/cli-ask-question.js` |
| G3 | board-prompt en no-TTY sin `--yes` | **espera para siempre** (sin timeout) | `src/utils/board-prompt-bridge.js` |
| G4 | sin tope wall-clock global ni auto-resume tras cuota | runaway / parada manual | `src/orchestrator/flow-control.js`, `standby-scheduler.js` |
| G5 | no hay comando que encadene plan→run→informe | dos invocaciones manuales | — |

## 4. Niveles de autonomía

Un único eje configurable (`autonomy`), default conservador, override por flag/env:

| Nivel | Comportamiento | Para |
|---|---|---|
| `interactive` (default) | Comportamiento actual: cada gate pregunta al humano (readline / board) | Desarrollo asistido |
| `assisted` | Decide lo de bajo riesgo; **escala al humano** solo lo de alto riesgo (decisión irreversible o fuera de la spec) | Confianza parcial |
| `autonomous` | **Nunca** pregunta al humano: cada gate degrada a una decisión del Arbiter; los backstops acotan el run | El summum: desatendido total |

Jerarquía de resolución: default shipped → flag `--autonomy <nivel>` / `--autonomous` (alias de `autonomous`) → `.karajanrc`/env. Cero ficheros obligatorios.

## 5. AUTO-A — El resolver central "decide-o-pregunta" (fundación)

**Un solo choke point** por el que pasan TODOS los puntos que hoy piden input. Hoy esa lógica está repartida (spec-review, checkpoint, board-bridge, reviewer); se unifica en un resolver:

```
resolveDecision({ question, options, context, risk }) → { choice, rationale, source }
```

- En `interactive`: delega en el `askQuestion` actual (readline o board) — **comportamiento intacto**.
- En `assisted`: si `risk === "high"` → escala al humano; si no → Arbiter.
- En `autonomous`: **siempre** Arbiter (AUTO-B). Nunca `null`, nunca bloqueo.

Reutiliza el `createCliAskQuestion` (`src/utils/cli-ask-question.js`) como rama `interactive`; añade las ramas `assisted`/`autonomous` que invocan el Arbiter. Todo consumidor (spec-review, flow-control checkpoint, reviewer-stage, board-bridge) pasa a llamar a `resolveDecision` en vez de a `askQuestion` directo → **un solo sitio que mantener**.

**Invariante:** en `autonomous`, `resolveDecision` SIEMPRE devuelve un `choice` del set de `options`; si el Arbiter no puede decidir, devuelve la opción más conservadora marcada en `options` (degradación segura).

## 6. AUTO-B — El Arbiter (el corazón): resolver conflictos eligiendo lo menos malo

El Arbiter es el rol con **autoridad de decisión**. Recibe un conflicto y devuelve un **veredicto** de un **conjunto cerrado**, con score de confianza y rationale.

### 6.1 Clases de conflicto que arbitra

- **Reviewer vs coder**: el reviewer rechaza, pero los tests de aceptación pasan (o viceversa).
- **Tester vs coder**: desacuerdo sobre si un escenario Gherkin se cumple.
- **AC sin pasar tras `max_iterations`**: el coder no logra verde.
- **Sonar new-issues**: nuevas incidencias sobre el baseline.
- **Spec ambigua**: spec-review con findings que impiden un plan limpio.
- **Pregunta abierta de una stage**: "¿qué patrón de auth uso?" sin respuesta determinista.

### 6.2 Conjunto cerrado de resoluciones (el "menos malo")

| Veredicto | Significado | Cuándo |
|---|---|---|
| `ACCEPT_WITH_DEFECT` | Acepta el estado actual y **registra el defecto** | Los tests de aceptación pasan aunque el reviewer tenga reparos no bloqueantes |
| `RETRY_DIFFERENT_APPROACH` | Reintenta con una directiva distinta al coder | Hay margen de iteración y señal de que otro enfoque converge |
| `DESCOPE_HU` | Reduce el alcance de la HU a lo que sí cumple | El AC completo no es alcanzable pero hay un subconjunto entregable |
| `BLOCK_AND_CONTINUE` | Marca la HU fallida, bloquea dependientes, sigue con el resto | No hay opción viable; la opción **más conservadora** |
| `PROCEED` | Continúa sin cambios | Spec ambigua pero la mejor lectura es razonable; o pregunta abierta con default sensato |

### 6.3 Jerarquía de verdad (cómo elige "lo menos malo")

El Arbiter ordena la evidencia por **fiabilidad de campo**, no por opinión:

1. **Tests de aceptación (ground truth)** — si pasan, mandan sobre cualquier opinión del reviewer.
2. **Must-fix del reviewer** (seguridad, corrección, datos) — por encima de estética.
3. **Nice-to-have** (estilo, refactor opcional) — nunca bloquea; se registra como defecto si se descarta.

Regla: **maximizar "encargo cumplido", minimizar "deuda introducida"**. Entre dos opciones malas, gana la que deja el AC más cubierto con menos riesgo irreversible.

### 6.4 Reuso (módulos reales) y degradación segura

`ArbiterRole extends AgentRole` (`src/roles/agent-role.js`), replicando `TriageRole`/`KarajanBrainRole`:

- **Modelo**: `resolveRole(config, "arbiter")` (`src/config/role-resolver.js`); default **haiku** (barato/rápido para decidir), fallback a `roles.coder`.
- **`buildPrompt`**: preamble + el conflicto serializado (evidencia: estado de tests, findings del reviewer, diffs, iteración actual) + el **esquema cerrado de veredictos** embebido.
- **`parseOutput`**: `extractFirstJson(raw)` (`src/utils/json-extract.js`).
- **`buildSuccessResult`**: valida `verdict ∈ VERDICTS` y `confidence ∈ [0,1]`; si inválido/`null` → `BLOCK_AND_CONTINUE` (degradación segura, nunca crashea).
- Se ejecuta con **`withBrainRecovery`** (`src/brain/with-brain-recovery.js`) → cuota/red heredan standby/fallback.

**Esquema de decisión:**

```json
{
  "verdict": "ACCEPT_WITH_DEFECT | RETRY_DIFFERENT_APPROACH | DESCOPE_HU | BLOCK_AND_CONTINUE | PROCEED",
  "confidence": 0.0,
  "rationale": "por qué es la opción menos mala",
  "defect": "qué deuda queda (si ACCEPT_WITH_DEFECT/DESCOPE_HU)",
  "directive": "instrucción para el coder (si RETRY_DIFFERENT_APPROACH)"
}
```

**Determinismo del control:** el LLM **emite un veredicto**, no controla el flujo. El mapeo veredicto→acción y los guards son deterministas. Si el Arbiter no aporta confianza (`confidence < umbral`), cae a `BLOCK_AND_CONTINUE`.

## 7. AUTO-C — La cadena desatendida (`kj autorun`)

Un solo comando encadena las fases. Reutiliza `kj plan` y `kj run --plan` existentes; **no los reimplementa**, los orquesta.

```
kj autorun <spec-file> [--autonomy autonomous]
 ├─ Fase 0 · Asegurar runtime KJ (init mínimo si falta config; no toca código del usuario)
 ├─ Fase 1 · spec-review → resolveDecision (en autonomous: el Arbiter decide PROCEED / auto-refinar; nunca aborta — cierra G1)
 ├─ Fase 2 · kj plan  → genera HUs (AC + grafo), persiste el plan
 ├─ Fase 3 · kj run --plan <id>  → ejecuta todas las HUs; cada gate interno pasa por resolveDecision (G2)
 │            bajo backstops de AUTO-D (wall-clock, timeout, auto-resume)
 └─ Fase 4 · Informe de resultado (AUTO-F) + exit code propagado (≠0 si HUs sin cumplir)
```

- **Atómico**: una invocación, sin pasos manuales (cierra G5).
- **Spec desde fichero**: `<spec-file>` es un `.md`/texto; se reusa `resolveTaskInput` (`src/utils/task-file.js`).
- **Exit code**: si al terminar hay HUs `failed`/`descoped` que incumplen el encargo mínimo → `process.exitCode = 1` (lo consume CI).

## 8. AUTO-D — Autonomía acotada: backstops

"Desatendido" no puede significar "colgado para siempre" ni "runaway de días". Tres límites duros (cierra G3, G4):

| Backstop | Comportamiento | Dónde |
|---|---|---|
| **Wall-clock del plan** | `max_wall_clock_hours` (default p. ej. 8h); al superarse → aborta limpio con **informe parcial** | `src/orchestrator/flow-control.js` (`checkSessionTimeout` ya existe para la iteración; se eleva al plan completo) |
| **Timeout de board-prompt** | En no-TTY, si nadie responde en `T` → **escala al Arbiter** (decide) en vez de esperar | `src/utils/board-prompt-bridge.js` (`askThroughBoard` gana timeout) |
| **Auto-resume tras cuota** | Al hibernar por cuota, un scheduler reanuda cuando la cuota resetea, sin `kj standby resume` manual | `src/brain/standby-scheduler.js` (ya hiberna; se añade el resume programado) |

Los backstops son **default ON** con override, no opt-in.

## 9. AUTO-E — Auto-resolución de stages (`--accept-recommended`)

Ninguna stage bloquea en `autonomous`. El loop coder↔reviewer↔tester converge solo:

- **Reviewer**: aplica las sugerencias **seguras** (no-rompedoras) y **escala las arriesgadas al Arbiter** (no al humano). El reviewer sigue siendo Sonar-intrínseco donde aplique (no se relaja el contrato de calidad existente).
- **Tester vs coder**: el desacuerdo lo zanja el **ground-truth** de los tests de aceptación.
- **Sin opción segura ni decisión clara**: registra el defecto y continúa (`ACCEPT_WITH_DEFECT`), nunca para.

Esto es la aplicación de AUTO-A/AUTO-B dentro de `reviewer-stage`/`run-hu-batch`: sustituir cada `askQuestion` de stage por `resolveDecision`.

## 10. AUTO-F — Informe de resultado ("cumple lo pedido, con defectos conocidos")

La entrega autónoma **debe ser auditable**. Al terminar, un informe (legible + `--json`) responde: *¿cumple el encargo? ¿con qué deuda?*

Contenido:
- **Lo pedido vs lo entregado**: por HU, AC pasados/fallados.
- **Decisiones del Arbiter**: cada veredicto con su rationale (el log del "menos malo").
- **Defectos residuales**: lo aceptado-con-defecto y lo descopado, explícito.
- **Veredicto global**: `DELIVERED` (encargo cumplido, con/ sin defectos) o `INCOMPLETE` (incumple el mínimo) → alinea con el exit code.

Reutiliza el `summary.md` y la telemetría existentes; añade la sección de decisiones/defectos.

## 11. Invariantes de seguridad

1. **Fase 1 (evaluación/plan) no destruye**: el plan se genera y persiste; el código del usuario solo se toca en la ejecución de HUs, cada una en su rama git aislada (ya es así en `run-hu-batch`).
2. **El LLM decide el QUÉ, no el CÓMO**: veredictos de set cerrado; el flujo y los guards son deterministas.
3. **Nunca un bloqueo indefinido en `autonomous`**: todo gate tiene timeout o degradación a veredicto conservador.
4. **Nunca un crash por salida basura**: `extractFirstJson` + validación + fallback `BLOCK_AND_CONTINUE`.
5. **Trazabilidad total**: cada decisión autónoma queda en el journal y en el informe final.
6. **El contrato de calidad existente no se relaja**: Sonar-intrínseco y los gates de tests siguen; lo que cambia es *quién resuelve el conflicto* (Arbiter, no humano), no *qué se exige*.

## 12. Mapa de reuso (no reinventar)

`AgentRole` + `extractFirstJson` + `resolveRole` + `withBrainRecovery` (patrón `discoverCommand`/`StartDecidorRole`) · `TriageRole`/`KarajanBrainRole` como plantilla del Arbiter · `createCliAskQuestion` como rama `interactive` del resolver · `run-spec-review` · `kj plan` (`plan/generate.js`) · `kj run --plan` (`hu-sub-pipeline.js` + `run-hu-batch.js`) · `flow-control` (timeout/checkpoint) · `standby-scheduler` (hibernate→auto-resume) · `summary.md` + telemetría (informe). Nada de `claude -p` crudo: modelo, coste, guards y fallback los hereda del motor de roles.

## 13. Slices → cards

| Slice | Card | Contenido | dev/biz |
|---|---|---|---|
| AUTO-A | KJC-TSK-0572 | Política `autonomy` + `resolveDecision` (choke point único) | 3/5 |
| AUTO-B | KJC-TSK-0573 | **ArbiterRole** (set cerrado, jerarquía de verdad, degradación segura) | 4/5 |
| AUTO-C | KJC-TSK-0574 | `kj autorun` (spec→plan→run→informe, atómico, exit code) | 3/4 |
| AUTO-D | KJC-TSK-0575 | Backstops (wall-clock, timeout de prompt, auto-resume, exit code) | 3/4 |
| AUTO-E | KJC-TSK-0576 | Auto-resolución de stages (`--accept-recommended`, sin bloquear) | 3/4 |
| AUTO-F | KJC-TSK-0577 | Informe "cumple lo pedido, con defectos conocidos" | 2/4 |

**Orden:** A → **B** → (C · E · F) → D. A y B son fundacionales (A/B bloquean C; B bloquea E y F). Depende del Brain-onboard (`kj start`, KJC-PCS-0061) para la infra de decisor.

## 14. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El Arbiter acepta deuda excesiva ("cualquier cosa cumple") | Jerarquía de verdad anclada en tests de aceptación; umbral de confianza; el informe expone toda la deuda → revisable |
| Runaway (días de ejecución, coste descontrolado) | Wall-clock duro + presupuesto heredado del BudgetTracker + exit en backstop |
| Bucle de `RETRY_DIFFERENT_APPROACH` infinito | `max_iterations` por HU sigue acotando; tras agotarse, el Arbiter solo puede `DESCOPE`/`BLOCK`, no reintentar |
| Decisión autónoma destructiva | Veredictos de set cerrado; ejecución en rama aislada; `kj-trash` cubre operaciones destructivas (ya integrado) |
| "Cumple lo pedido" subjetivo | El mínimo se define por los AC del plan; `INCOMPLETE` si no se cubren → exit ≠0, no es opinión |
| El usuario pierde visibilidad | Informe AUTO-F + journal + HU Board reflejan cada decisión; `assisted` como punto intermedio si quiere estar en el loop de lo arriesgado |

## 15. Métricas de aceptación

- `kj autorun <spec> --autonomy autonomous` sobre un proyecto de prueba (nuevo/existente) **termina sin pedir input humano** y produce código que pasa sus propios AC (verificable: el informe marca `DELIVERED`).
- Ante un conflicto reviewer-vs-tests inyectado, el Arbiter prioriza los tests y **registra el defecto** (no aborta).
- En `autonomous`, **ningún** gate (spec-review, checkpoint, reviewer, board) bloquea ni aborta; cada uno produce una decisión trazada.
- Ningún run autónomo excede `max_wall_clock_hours`; tras una cuota simulada, **auto-resume** sin intervención.
- El Arbiter **nunca crashea** ante salida basura (cae a `BLOCK_AND_CONTINUE`).
- El informe final lista AC pasados/fallados, decisiones y defectos; el exit code concuerda con `DELIVERED`/`INCOMPLETE`.

## 16. Fuera de alcance (por ahora)

- **Aprendizaje entre runs** (que el Arbiter mejore sus decisiones con histórico) — futura iteración sobre journal+RAG.
- **Ejecución multi-proyecto en paralelo** desatendida.
- **Auto-merge a producción** sin gate humano final — fuera de alcance por seguridad; la entrega autónoma produce ramas/PRs, no despliega.
- **Refinamiento profundo de spec por diálogo** — en `autonomous` se decide con la mejor lectura; el diálogo de refinamiento es de `interactive`/`assisted`.
