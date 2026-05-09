# Karajan Code — Plan de testing por niveles (dogfooding)

> **Origen**: rescatado del transcript JSONL `2a836d46…` el 2026-05-07 tras la compactación de contexto. El plan original lo elaboramos antes de la charla del 21 mayo y se ejecutó parcialmente (N0–N3 hechos en la sesión del 2026-05-07; N3 destapó 4 bugs que ya están arreglados; N4–N9 pendientes).
>
> **Recordatorio**: en este repo `kj` se ejecuta vía `npm link`, así que cualquier merge a `main` es inmediato — **no hace falta reinstalar** entre niveles.

## Tabla resumen

| Nivel | Qué prueba | Tiempo real | Coste tokens | LLM | Estado 2026-05-07 |
|-------|------------|-------------|--------------|-----|-------|
| N0 | Sanity binarios + doctor | 30 s | 0 | no | ✅ Re-validado verde |
| N1 | Comandos read-only sin LLM | 2 min | 0 | no | ✅ Re-validado verde |
| N2 | Roles individuales con LLM | 5 min | 5–30 ¢ | sí | ✅ Re-validado verde |
| N3 | `kj run` con tarea trivial | 10 min | 30–80 ¢ | sí | ✅ Re-validado verde |
| N4 | `kj run` zero-config con tarea rica | 5–10 min | $1–3 | sí | ✅ Re-validado verde |
| N5 | Auto-HU decomposition (sub-pipelines) | 20–30 min | $2–5 | sí | ✅ Verde (sub-pipeline real en N6) |
| N6 | Plan flow (`kj plan generate` + `kj plan ready` + `kj run --plan`) | 30 min | $3–5 | sí | ✅ Verde (7 HUs, 12 commits) |
| N7 | Resilience / failure modes | 10 min | bajo | mixto | ✅ Verde (4/4 sub-tests) |
| N8 | Demo scripts literal (los 3 .txt de la charla) | 15–20 min | depende | mixto | ✅ Verde (3/3 demos) |
| N9 | Ensayo completo cronometrado | 40 min | depende | sí | 🟡 Pendiente del usuario (manual) |

---

## N0 — Sanity binarios (30 s, riesgo 0)

```bash
kj --version                     # ⇒ 2.10.x (la actual)
kj --help | head -30             # ⇒ lista subcomandos sin crash
kj doctor --check-only           # ⇒ exit 0 (o 1 con hints concretos)
```

**Pasa si**: versión correcta, doctor verde (o sólo SKIPs legítimos).
**Falla si**: la global no apunta al `npm link` del repo (`which kj` debería resolver al binario del repo).

Histórico 2026-05-07: ✅ Verde. 14 OK / 7 SKIP / 0 FAIL.

---

## N1 — Comandos read-only sin LLM (2 min, 0 tokens, 0 fs writes)

```bash
cd ~/ws_npm-packages/karajan-code

kj audit --agent-readiness                              # ⇒ 100/100
kj audit --agent-readiness --json | jq '.score'         # ⇒ 100 (regresión del showstopper)
kj audit --agent-readiness --path /tmp                  # ⇒ score bajo + hints

kj config                                                # ⇒ config válida, sin errors
kj agents                                                # ⇒ lista qué CLIs tienes logueados
kj roles                                                 # ⇒ los 13 roles
kj skills                                                # ⇒ skills addyosmani disponibles
kj status                                                # ⇒ "no active session" si limpio
```

**Pasa si**: todo `exit 0`, agent-readiness 100/100, `jq` parsea. Estos son los comandos seguros para enseñar en cualquier momento sin riesgo.

Histórico 2026-05-07: ✅ Verde. 100/100 confirmado, showstopper cerrado.

---

## N2 — Roles individuales con LLM (5 min, 5–30 ¢)

```bash
# Triage clasifica complejidad sin escribir nada
kj triage "Añade un endpoint /health a un servidor Express"
# ⇒ devuelve { level, taskType, roles[], hus[] }

# Researcher explora el propio repo
cd ~/ws_npm-packages/karajan-code
kj researcher "¿Dónde decide Brain entre Solomon y fallback?"
# ⇒ summary con paths concretos

# Reviewer sobre cambios actuales vs main (REQUIERE un task — lo positional o --task-file)
kj review --base-ref main "Verifica que los cambios mantienen los contratos del módulo afectado"
# ⇒ JSON con approved / blocking_issues / non_blocking_suggestions / confidence.
# Si la rama coincide con main (diff vacío), el reviewer responde "no diff in request" y aprueba — esto es lo esperado.

# Audit deterministic — zero tokens, full pipeline excepto LLM
kj audit --deterministic-only
# ⇒ basal cost, sonar findings, OSV CVEs, semgrep, webperf, stack
```

**Qué mirar**:
- CLI coder logueado (`claude --version` + `claude -p "test"`).
- Cada rol imprime `tokens + cost` al final. Si no → bug latente.
- Docker `kj-sonar` up: `docker ps | grep sonar`.

**Stop si** algún rol crashea — no subir hasta arreglar.

Histórico 2026-05-07: ✅ Verde. Triage 7.2 s, Researcher 90.9 s. Sonar 401 token expirado y MCP-CLI parity bug observados (3 issues operacionales que ya están en backlog/arreglados).

Re-validado 2026-05-07 (post-fixes hygiene + writeConfig): ✅ Verde.
- Triage `simple/sw/[reviewer,tester]` en 13.7 s.
- Researcher 94.7 s (10 affected_files, 7 patterns, 6 constraints, 6 risks).
- Review `--base-ref main` con task arg en 18.9 s — devuelve approved con "no diff in request" (esperado: rama sincronizada con main).
- Audit deterministic 3.7 s — 304 sonar issues, 4 unused deps, 4 dead exports, +6680 LOC desde 2026-05-04.
- Hallazgo cosmético resuelto: el help de `kj review/run/code/plan generate/discover/triage/researcher/architect` decía `[task]` (opcional) sin reflejar el requerimiento "task O --task-file". Aclarado en PR (texto "Task description (REQUIRED — provide as argument or via --task-file)").

---

## N3 — `kj run` con tarea trivial (10 min, 30–80 ¢)

```bash
cd /tmp && rm -rf kj-test-3 && mkdir kj-test-3 && cd kj-test-3
git init -q && echo "module.exports = {};" > index.js
git add . && git commit -q -m "initial"

kj run "Add a JSDoc comment to index.js explaining what it exports" -y
```

**Lo que tiene que pasar**:
1. Triage clasifica como `simple` / `trivial`.
2. Coder hace 1 cambio mínimo.
3. Reviewer aprueba.
4. Audit final certifica.
5. **`git log --oneline` debe mostrar UN solo commit** (no dos: el bug N3-1 lo destapó).

**Stop si**: aparecen dos commits con prefijos distintos (`docs:` + `feat:`) → regresión del N3-1.

Histórico 2026-05-07: ⚠️ Pasó pero con 4 bugs detectados:
- **N3-1** double-commit → arreglado en PR #621.
- **N3-2** addyosmani force-push → KJC-BUG-0033 / PR #625.
- **N3-3** init persiste `sonarqube.enabled` deprecado → KJC-BUG-0034 / PR #626.
- **N3-4** "Missing git remote.origin.url" warning ruidoso → KJC-TSK-0373 / PR #624.

**Verificación tras los fixes**: re-correr este nivel debería dar 1 sólo commit, sin warnings, y sin "kj-test-3" colgándose en el HU Board (KJC-TSK-0371 / PR #627 lo limpia tras 24 h).

---

## N4 — `kj run` zero-config con tarea rica (5–10 min, $1–3)

> Ésta es la **demo principal de la charla** (slide 18 happy-path).

```bash
cd /tmp && rm -rf kj-test-4 && mkdir kj-test-4 && cd kj-test-4
# ⚠️ Sin git init manual — valida autoInit (kj crea repo, .gitignore, .karajan/, etc.).

kj run "Build a REST API for a todo list. Express + Vitest. Endpoints: GET /todos, POST /todos, DELETE /todos/:id. With validation, error handling, and tests" -y
# ⚠️ Sin --auto-commit flag — debe leerlo de config.
```

**Qué buscar durante la ejecución**:
1. Triage clasifica como `complex` → activa planner.
2. Planner descompone en 3-5 HUs atómicas (GET, POST, DELETE, validation, tests).
3. HU Board arranca solo en `:4001` (4000 ocupado por board manual).
4. Cada HU corre como sub-pipeline con su propia branch + commit.
5. Tests reales se generan y pasan (TDD enabled).
6. Sonar escanea y reporta findings.
7. Audit final certifica.

**Stop si**: alguna HU se queda zombi (`coding` sin avanzar) — debería ser cosa del pasado tras los fixes #534/#537/#544.

**Métrica nueva (v2.12.0)**: `summary.md` debe terminar con sección **`## Plan adherence`** mostrando score 0–100, tabla de los 4 componentes (commit attribution 40%, acceptance tests 30%, scope discipline 20%, dependency order 10%) y lista de HUs sin commit atribuido. Si la sección no aparece → comprobar que `session._planRef.planId` se guardó tras el planner. Spec: `docs/plan-adherence.md`.

---

## N5 — Auto-HU decomposition (20–30 min, $2–5)

```bash
cd /tmp && rm -rf kj-test-5 && mkdir kj-test-5 && cd kj-test-5
git init -q

kj run "Build a REST API for a todo list. Express + Vitest. Endpoints: GET /todos, POST /todos, DELETE /todos/:id. With validation, error handling, and tests" -y --auto-commit
```

**Lo que valida** (es la demo de la charla literal):
- Triage detecta complejidad → llama al planner.
- HU Board arranca solo en `:4000`.
- N HUs ejecutan en sub-pipelines.
- Branch + PR creado por cada HU si `auto_pr` está on.
- HU Board muestra progreso live.

**Qué hacer durante**: abrir `http://localhost:4000` mientras corre. Verificar que los estados pasan `coding → reviewing → done`.

**Stop si**: una HU se queda zombi — bug arreglado hace una semana, debería estar gone.

Re-validado 2026-05-07: ✅ Verde. **Pero ojo a la expectativa**: con la config por defecto (`pipeline.hu_reviewer.enabled: false`) el triage clasifica esta tarea como `medium (sw)` y el flow ejecuta como single-task pipeline, NO como auto-HU sub-pipeline. Eso es lo correcto dado el config — la demo "varias HUs en paralelo" se valida realmente en **N6** (plan flow), no aquí. Resultados de la corrida: 5 commits con prefijos correctos (chore + feat×2 + test + fix), Sonar SKIPPED limpio (gris), 10m13s, $2.56. Para forzar sub-pipeline aquí se necesita `kj init` con HU Reviewer activo o usar la ruta de N6.

---

## N6 — Plan flow (10 min sin LLM + ejecución del plan)

```bash
cd /tmp && rm -rf kj-test-6 && mkdir kj-test-6 && cd kj-test-6
git init -q

# Phase 1: generar plan (gasta tokens del planner)
kj plan generate "Build the same todo API as test-5"
# Anota el planId que sale

kj plan list                       # ⇒ aparece el plan
kj plan show <planId>              # ⇒ tabla de HUs
kj plan validate <planId>          # ⇒ ok / lista de issues
kj plan ready <planId>             # ⇒ marca como ejecutable

# Phase 2: ejecutar el plan
kj run --plan <planId> -y
```

**Qué valida**: el flujo plan-driven separado del run zero-config (N5). Útil cuando quieres revisar/editar el plan antes de gastar tokens del coder.

Re-validado 2026-05-07: ✅ Verde. 7 HUs generadas, todas certificadas y ejecutadas como sub-pipelines. 12 commits resultantes. session.status correctamente sellada como `approved` (BUG-0037 fix verificado live). Total 22m 16s.

> ⚠️ **Hallazgo durante este nivel** (arreglado hoy en PR #636): cuando el repo se inicializa con `git init -q` y `init.defaultBranch=master`, la rama `main` no existe localmente. Antes del fix, `prepareHuBranch` emitía 7 warnings idénticos ("`'main' is not a commit`") y cada HU caía silenciosamente a la rama original. Ahora hay un fallback `main → master → HEAD` que escoge la primera ref existente.

---

## N7 — Resilience / failure modes (10 min, casi cero coste)

```bash
# A) Lighthouse missing → kj webperf debe skipear con warn
kj webperf https://karajan-code.web.app
# ⇒ si tienes lighthouse, score; si no, "skipped — lighthouse not installed"

# B) Sonar down → kj run debe seguir
docker stop kj-sonar
cd /tmp/kj-test-3
kj run "Tiny tweak again" -y --no-sonar
# ⇒ corre sin sonar, sin crash
docker start kj-sonar

# C) Resume tras kill
cd /tmp && rm -rf kj-test-7 && mkdir kj-test-7 && cd kj-test-7
git init -q
kj run "Build something complex..." -y &
KJPID=$!
sleep 30                # deja que arranque
kill $KJPID
ls ~/.karajan/sessions/ | tail -3
kj resume <sessionId>
# ⇒ retoma sin perder contexto

# D) kj clean es dry-run por defecto (--yes para borrar de verdad)
kj clean
# ⇒ enumera lo que borraría sin tocar; añade --yes para aplicar.
```

Re-validado 2026-05-07: ✅ Verde.
- A) `kj webperf` con lighthouse missing → reporta WARN + "skipped" + exit 0. ✓
- B) `kj run --no-sonar` → emite deprecation warning ("flag ignored since v2.7.4"), audit input "skipped: host not reachable", APPROVED en 54s. ✓
- C) Resume tras kill → `kj resume <sessionId>` retoma exitosamente; al completar, status sellado correctamente. ✓
- D) `kj clean` (dry-run default) → "[clean] nothing to clean — ~/.kj/ and ~/.karajan/ are tidy". ✓
- ⚠️ Doc-fix: el flag `--dry-run` no existe; es el comportamiento por defecto. `--yes` aplica.

---

## N8 — Demo scripts literal (15–20 min)

Ejecuta cada uno de los 3 scripts **sin trampas**, como si fuera la charla:

```bash
# Necesitas un repo OSS clonado:
git clone https://github.com/expressjs/express ~/oss/express

# Demo 1 (1 min, sin LLM)
bash -c "$(cat ~/ws_npm-packages/karajan-code/docs/demos/agent-readiness.txt)" 2>&1 | tee /tmp/demo1.log

# Demo 3 (2 min, con LLM)
cd ~/ws_npm-packages/karajan-code
bash -c "$(cat docs/demos/audit-with-llm.txt)" 2>&1 | tee /tmp/demo3.log

# Demo 2 (5–10 min, con coder)
mkdir /tmp/karajan-demo && cd /tmp/karajan-demo
bash -c "$(cat ~/ws_npm-packages/karajan-code/docs/demos/happy-path.txt)" 2>&1 | tee /tmp/demo2.log
```

**Qué validar**: que cada script funciona end-to-end sin retoques manuales y los timings caben en el slot reservado.

Re-validado 2026-05-07: ✅ Verde.
- Demo 1 (`agent-readiness.txt`): exit 0, sin LLM, output consistente.
- Demo 3 (`audit-with-llm.txt`): exit 0, full audit two-phase. 8m 36s, 28 findings priorizadas (security/codeQuality/performance/architecture/testing/accessibility), $7.18 (haiku-4-5), reporte markdown escrito a `~/audits/karajan-YYYYMMDD.md`.
- Demo 2 (`happy-path.txt`): exit 0 en 8m 08s. APPROVED, 6 commits del coder con prefijos correctos (chore + feat×2 + test + fix×2). $1.87. Sonar SKIPPED gris. session.status sellado correctamente.

---

## N9 — Ensayo completo (40 min con cronómetro)

A 5-7 días de la charla:

1. Abrir el PPTX en presentation mode.
2. Cronómetro en marcha.
3. Pasar cada slide pronunciándolo en voz alta.
4. En slide 18 (*switch to terminal*) ejecutar el demo `agent-readiness` en directo.
5. Si va sobrado, ejecutar también `happy-path` o `audit-with-llm`.
6. Total ≤ 40 min con margen para preguntas.

**Graba un asciinema de los demos exitosos como backup**:

```bash
asciinema rec ~/karajan-demo-backup.cast --idle-time-limit 2
# ejecuta los demos
# Ctrl-D al terminar
```

Si el demo en directo falla, reproduces el `.cast` y sigues hablando.

---

## Limpieza entre niveles

Tras cada nivel `kj run`-driven:

```bash
kj board stop
kj clean --nuke -y      # wipe DB del board (sin --nuke deja zombis)
kj board start          # arranca limpio
```

> **Nota**: `kj clean` sin `--nuke` deja zombis visibles en el board. Tras los PRs #623 (zombie reaper) + #627 (ephemeral cleanup) la situación está mucho mejor — los proyectos `tmp_*`/`test_*`/`demo_*`/`kj-test-*` con >24 h de inactividad se purgan solos al arrancar el board.

## Mantenimiento de este documento

- Cada vez que aparezca un bug nuevo en un nivel, anótalo bajo "Histórico" del nivel correspondiente con su Card ID y PR.
- Cuando tras un fix el nivel pase 100 % verde sin observaciones, registra la fecha (`Re-validado YYYY-MM-DD`).
- Si añades un Nivel N+1 al plan, mete su entrada en la tabla resumen al inicio.
