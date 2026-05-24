# SPEC conventions for Karajan task files

Esta guía explica **cómo escribir un `*.task.md`** para que `kj plan generate` (y, por extensión, `kj architect`, `kj researcher`, `kj run`) produzca planes/análisis de la mayor calidad posible.

El planner de Karajan tiene **6 patologías conocidas** que el prompt v2.14.1+ ya intenta evitar y **2 convenciones de forma** que activan funcionalidad adicional (`spec_section` + `acceptance_tests`). Pero el LLM no es infalible: si tu task file **no le da las señales correctas**, las patologías reaparecen o la funcionalidad se queda sin activar. Este documento te dice qué señales emitir.

> **Nota**: lo que aquí se explica vale para el planner. Si solo usas `kj run` (single-task, no plan), basta con un task description corto en lenguaje natural — esto solo aplica cuando vas a descomponer en múltiples HUs.

## Tabla rápida — qué declarar y qué obtienes

| Si declaras esto en tu task file… | …el planner produce… |
|---|---|
| `### Épica PROFILE — ficha de persona` | `[PROFILE]` prefix en cada title de esa área |
| `NO incluye en este plan: vistas compartidas, X` | Esos ítems van a `outOfScope`, no se generan HUs |
| `Plan 3 handles dashboards comparativos` | Idem — cross-plan reference reconocida |
| `Listado transversal de TODOS los X filtrables` | `blocked_by` = [X1, X2, …, XN] (transversal, no solo el primero) |
| `Utilidad reutilizable de versionado` + uso explícito | HUs consumidoras llevan `reuse: ["util_id"]` en lugar de re-implementar |
| `Guardarraíl AVISA-no-BLOQUEA` o `async, no precondiciona` | Los guardarraíles **NO** aparecen como `blocked_by` de las HUs que observan |
| `Depende: HU-X` / `Después de Y` / `Requires Z` | `blocked_by` populado correctamente |
| `Sin deps` / silencio | `blocked_by: []` (NO se inventan deps) |
| `## 1.`, `### 2.1`, `§5` (headings numerados en el task) | Cada HU lleva `spec_section: "1"` / `"2.1"` / `"5"` — REQUIRED si hay SPEC estructurado |
| Sin secciones numeradas | `spec_section: null` permitido — no se exige |
| (siempre) | Cada step lleva 2-4 `acceptance_tests` mix gherkin + shell, pre-implementación |

## 1. Épicas con `### Épica NOMBRE`

**Por qué importa**: el primer carácter del title de cada HU en el board es el ID. Si no le das estructura al planner, los titles salen como `"Construir utilidad de envelope encryption…"` sin orientación visual. Si declaras épicas, salen como `"[INFRA] Utilidad envelope encryption…"`.

**Convención**:

```markdown
### Épica PROFILE — ficha de persona
1. Subir CV (PDF/DOCX) cifrado a Storage…
2. Cloud Function processCV trigger…

### Épica ASSESS — assessments en 4 dimensiones
3. Crear assessment manual con 4 dimensiones…
4. Versionar assessment al editarse…

### Épica GUARD — guardarraíles AVISA-no-BLOQUEA
5. Guardarraíl 1 — evaluar outcome…
```

El planner detecta `### Épica NOMBRE` (con cualquier variante: `## Phase X`, `## Layer N — name`, `# AUTH`, etc.) y prefija los HUs con `[NOMBRE]`.

**Fallbacks que aplica el planner**:
- Si una HU es infraestructura/setup sin épica clara: `[INFRA]`
- Si es utilidad cross-cutting: `[SHARED]`
- El prefix se mantiene `<=12 chars` y `MAYÚSCULAS` para consistencia visual.

## 2. Scope exclusions con `NO incluye en este plan:`

**Por qué importa**: sin esto, el planner mete HUs para todo lo que mencionas, aunque sea de un plan futuro. Causó P1 (KJC-BUG-0042) en dogfooding GRETA Plan 2.

**Patrones reconocidos** (ES + EN, case-insensitive):

```markdown
NO incluye en este plan: vistas compartidas, dashboard radar, mapa de calor.
Fuera del scope: real-time sync, mobile app.
Out of scope: payment integration, OAuth providers beyond Google.
Not in this plan: admin UI, batch import.
Plan 3 handles cross-tenant views and shared dashboards.
Reserved for plan 4: federation, multi-region replication.
```

**Cómo funciona**: el planner detecta las listas y las renderiza como sección **`FORBIDDEN scope`** en el prompt. Si una HU candidata tocaría esos ítems, el planner la mueve a `outOfScope` en vez de generarla.

**Antipatrón**: NO uses esto para indicar "esto no se implementa nunca". Eso va en risks. `NO incluye` es para "esto es real pero pertenece a OTRO plan".

## 3. Deps transversales — listados que requieren TODOS los miembros

**Por qué importa**: el planner solía declarar deps al **primero** de una categoría cuando una HU las requería TODAS. Causó P2 (KJC-BUG-0043) en dogfooding.

**Patrón a usar** en tu task file:

```markdown
- Listado transversal de TODOS los warnings filtrables por guardrail.
- Vista de todas las assessments validadas por IA (no manuales).
- Dashboard que agrega TODOS los outcomes del equipo.
- Summary across all guardrails.
```

**Frases clave que el planner reconoce**: `listado transversal`, `list of all`, `summary across`, `dashboard que agrega todos`, `todos los X filtrables`. Si el acceptance test/scope de tu HU "consumidora" menciona la categoría entera, el planner pondrá `blocked_by: [X1, X2, …, XN]` con todos los miembros.

## 4. Reuse — utilidades compartidas

**Por qué importa**: el planner solía re-implementar utilidades existentes en cada HU consumidora. P3 (KJC-BUG-0044). El campo `reuse` resuelve esto pero solo si el SPEC lo señala.

**Patrón en el task file**:

```markdown
### Spike — utilidades compartidas

- **versionado** (HU INFRA-VERS): utilidad reusable de versionado con SemVer
  + diff. Usada por: ASSESS-VER, AI-PROMPTS, IMPACT-CHALLENGES.
- **envelope encryption** (HU INFRA-CRYPTO): KMS DEK per-instance. Usada por:
  PROFILE-CV, AI-TRANSCRIPT, IMPACT-EVIDENCE.
```

Lo que el planner emitirá en las HUs consumidoras:

```json
{
  "id": "ASSESS-VER",
  "description": "[ASSESS] Versionar assessment al editarse",
  "dependencies": ["INFRA-VERS"],
  "reuse": ["INFRA-VERS"]
}
```

**Distinción semántica**:
- `dependencies`: "X debe estar terminado antes de empezar Y" (ordering).
- `reuse`: "Y consume el ARTEFACTO de X — no re-implementar la misma lógica" (DRY).
- Por convención: si declaras `reuse: ["INFRA-X"]`, debes declarar también `dependencies: ["INFRA-X"]`.

## 5. Async observers (guardarraíles, cron, listeners, queues)

**Por qué importa**: el planner solía declarar `Outcome blocked_by Guardarraíl-1` cuando el guardarraíl es async observer. P6 (KJC-BUG-0047). Rompía AVISA-no-BLOQUEA en GRETA.

**Patrones a usar** para indicar al planner que algo es async observer:

```markdown
- **Guardarraíl 1** — evalúa outcome async on-save. **AVISA, no BLOQUEA**.
- **Cron diario** que valida assessments caducados. Async, no precondiciona.
- **Audit log** de lecturas. Observer reactivo, no bloquea.
- **Webhook** Stripe → reactive, async.
- **Retry queue** Pub/Sub para guardarraíles que fallan. Async.
```

**Frases clave**: `AVISA-no-BLOQUEA`, `observa`, `async`, `reactivo`, `cron`, `webhook`, `listener`, `Pub/Sub`, `después sin bloquear`, `evalúa pero no precondiciona`.

**Heurística del planner**:
- ¿X **consume** un deliverable de Y que debe **existir** antes de empezar? → `X blocked_by Y` ✅
- ¿Y **reacciona** a X después? → paralelos, NO `blocked_by` ✅

## 6. Dependencias explícitas

El planner reconoce estas frases en la prosa de tu task file:

| Frase | Acción |
|---|---|
| `Depende: AUTH-005, PROFILE-001` | `blocked_by: ["AUTH-005", "PROFILE-001"]` |
| `requires X` | `blocked_by: ["X"]` |
| `after Y` | `blocked_by: ["Y"]` |
| `needs Z first` | `blocked_by: ["Z"]` |
| `blocked by W` | `blocked_by: ["W"]` |
| `Sin deps` (o silencio) | `blocked_by: []` |

**Importante**: NO encadenes HUs por orden de aparición. Si una HU **no depende de nada**, déjala sin frase de dep — el planner emitirá `blocked_by: []` (que es correcto).

## 7. Gestión de findings del reviewer

Tras generar el plan, **siempre hay findings advisory**. Es normal:
- `missing_hus`: gaps reales del SPEC que el planner no cubrió. Aplica con `kj plan add-hu` o edita el JSON.
- `missing_dependencies`: deps que el planner no infirió. Aplica con `kj plan update-hu`.
- `scope_overlaps`: pares de HUs que tocan lo mismo. Decide cuál borrar/fusionar.
- `order_issues`: ordering problemático. Reordena con `kj plan reorder`.

El plan-fixer (P4) intenta resolverlos automáticamente. **Si tras 1-2 iteraciones se mantienen**, son gaps reales — edita a mano. El P5 convergence guard garantiza que el plan-fixer **nunca empeora** el plan, así que es seguro dejar el fixer hacer su trabajo.

**Densidad de findings aceptable**:
- < 15% (findings/HUs): bien.
- 15-25%: planeable, requiere ediciones manuales.
- > 25%: probablemente el task file está incompleto o ambiguo — revisa.

## 8. Secciones numeradas → `spec_section` automático

**Por qué importa**: si tu task file tiene encabezados numerados (`## 1.`, `### 2.1`, `§5 Initial Scope`), el planner detecta que es un **SPEC estructurado** y exige que cada HU declare a qué sección pertenece via el campo `spec_section`. Sin esto, los findings del reviewer no pueden mapear ofertas a la sección del SPEC que las origina y la trazabilidad se pierde.

**Patrón en el task file**:

```markdown
## 1. Auth
### 1.1 Login con OAuth Google
### 1.2 Logout idempotente

## 2. Profile
### 2.1 Edición de avatar
### 2.2 Borrado de cuenta GDPR
```

Lo que el planner emitirá:

```json
{
  "id": "AUTH-LOGIN",
  "description": "[AUTH] Login con OAuth Google",
  "spec_section": "1.1",
  "dependencies": [],
  "reuse": []
}
```

**Reglas**:
- Cuando hay secciones numeradas: `spec_section` REQUIRED en cada step. NUNCA `null`, NUNCA omitido, NUNCA una paráfrasis libre.
- Si un step cubre varias secciones, usa la más específica (`"2.1"` antes que `"2"`).
- Si un step no mapea a ninguna sección detectada, el step está mal — refactoriza el SPEC para que cubra el caso o quita el step.
- Sin secciones numeradas: `spec_section` queda opcional (`null` permitido).

**Frases que activan la detección**: `## N.`, `### N.M`, `§N`, `## Section N — title`.

## 9. `acceptance_tests` por step — gherkin + shell mix

**Por qué importa**: cada HU emitida por el planner lleva 2-4 acceptance tests escritos ANTES de implementar el step (test-first). Estos tests son la línea entre "step en progreso" y "step done" — el sub-pipeline los ejecuta tras cada iteración del coder.

**Shape obligatorio en cada step**:

```json
"acceptance_tests": [
  { "type": "gherkin", "content": "Given a logged-in user\nWhen they click logout\nThen the session cookie is cleared" },
  { "type": "shell",   "content": "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/logout | grep -q '^204$'" }
]
```

**Reglas**:
- Mínimo 2, máximo 4 tests por step. Si necesitas más, el step probablemente abarca demasiado — pártelo.
- Mix de `gherkin` (comportamiento observable, lo lee humano + agente) y `shell` (comando concreto que exit 0 al pasar el test, lo ejecuta el sub-pipeline).
- Cubrir al menos un happy path y un edge case / failure mode.
- **Prohibido** el placeholder genérico `"npx vitest run"`: cada test debe afirmar algo específico al step, no "todos los tests del repo deben pasar".
- Los tests son **pre-implementación**: deben fallar hasta que el step se complete, pasar después.

**Cómo se enchufan en el sub-pipeline**: Brain lanza los `shell` tests tras cada iteración del coder; todos pasan → step `certified`; alguno falla → diagnostica con el error exacto y vuelve al coder con feedback.

## Tabla de antipatrones (NO HACER)

| Antipatrón | Por qué falla | Hacer en su lugar |
|---|---|---|
| Tabla rígida `\| ID \| Actor \| Precondiciones \|` con 30 casos ya escritos | El planner lo trata como "plan ya hecho" y solo lo reformatea | Prosa narrativa en `## Funcionalidades` (ver `plan-generate.md`) |
| Mencionar features del Plan 3 sin marcarlas | El planner las arrastra al Plan 2 | `NO incluye en este plan: …` |
| Listar HUs sin orden de épica | Titles del board sin orientación | `### Épica NOMBRE — desc` por área |
| "El listado depende del primer guardarraíl" | Solo 1 dep, falla en runtime | "Listado transversal de TODOS los guardarraíles" |
| Repetir lógica de utilidad en cada HU | Re-implementación duplicada | Declarar la utilidad como spike + listar consumidores |
| "Outcome depende de Guardarraíl-1" | `blocked_by` semántico-erróneo | "Outcome es evaluado por G1 async; G1 AVISA-no-BLOQUEA" |

## Referencia rápida — checklist antes de generar

- [ ] ¿Cada área del SPEC tiene `### Épica NOMBRE`? (orientación visual)
- [ ] ¿Está `NO incluye en este plan: …` con TODOS los items que pertenecen a otros planes?
- [ ] ¿Las HUs "agregadoras" / "transversales" usan la palabra **TODOS** explícita?
- [ ] ¿Las utilidades compartidas están declaradas como spike + lista de consumidores?
- [ ] ¿Los guardarraíles/cron/listeners mencionan **AVISA-no-BLOQUEA** o **async**?
- [ ] ¿Las dependencias entre HUs están en prosa (`Depende: X`, `requires Y`)?
- [ ] ¿Está el bloque `## Reglas no negociables` para constraints transversales?
- [ ] Si el task tiene headings numerados (`## 1.`, `### 2.1`, `§5`), ¿esperas ver `spec_section` populado en cada HU del plan? (REQUIRED en ese caso — el planner lo exige).
- [ ] ¿Has dejado espacio para que el planner emita 2-4 `acceptance_tests` por step (mix gherkin + shell)? No tienes que escribirlos tú — los compone el planner — pero saber que existen evita sorpresas al inspeccionar el plan generado.

## Documentos relacionados

- [`plan-generate.md`](plan-generate.md) — comando + plantilla específica de task file
- [`architect.md`](architect.md) — comando + cómo invocar al architect role
- [`researcher.md`](researcher.md) — comando + cómo invocar al researcher
- [`run.md`](run.md) — comando + cuándo usar single-task vs plan
- [`discover.md`](discover.md) — comando + cómo detectar gaps antes de planear
- [`refactorer.md`](refactorer.md) — comando + cuándo usar el refactorer role
