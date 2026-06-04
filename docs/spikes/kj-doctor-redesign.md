# Spike: Rediseño de `kj doctor` — separar sistema vs proyecto

**Task:** KJC-TSK-0416
**Epic:** KJC-PCS-0006 (DevOps & Installer)
**Status:** Spike — research only, no production code in this PR
**Date:** 2026-06-04
**Author:** dev_016 (BecarIA, AI) / codeveloper dev_001 (@manufosela)

## 1. Motivación: el incidente del 21-may-2026

Durante una demo en directo del 2026-05-21, `kj doctor` se ejecutó en
`~/demo/kanban-app` (proyecto recién scaffold-eado, sin `git remote` aún).
El comando emitió:

```
WARN  GitHub push access (current remote): git ls-remote origin falló (exit 128):
      fatal: 'origin' does not appear to be a git repository
...
1 issue(s) found, 0 auto-fixed, 3 warnings
```

En pantalla compartida el output **parece un fallo del sistema** cuando en
realidad es un check que no aplica al contexto (no hay remote configurado,
luego no hay nada que validar). El check de `gh remote` debería haber
producido un SKIP — el sistema está perfectamente sano, sólo el proyecto
todavía no tiene remote.

Este spike evalúa opciones para que `kj doctor` distinga
**checks de sistema** (Node, agentes, MCPs, ~/.karajan) de **checks de
proyecto** (remote, write perms, `.env` consistency) y produzca un output
contextual según el escenario de uso (demo pública, CI, dev local, sysadmin).

## 2. Inventario de checks actuales

`src/commands/doctor.js` ensambla la lista llamando a 16 módulos en
`src/checks/*`. Total: **~46 checks únicos** (varía según el config porque
algunos son condicionales — provider CLIs, audit tools gated by stack,
project signals).

### 2.1 Por scope

#### SYSTEM (no dependen del cwd / proyecto)

| Check | Módulo | Strategy | Severity al fallar |
|---|---|---|---|
| `karajan` | system.js | manual | warn |
| `node-version` | node.js | manual | fail |
| `hw-ram`, `hw-cpu`, `hw-disk`, `hw-gpu` | hardware.js | manual | warn |
| `karajan-dirs` | dir-setup.js | auto | fail |
| `legacy-kj-home` | dir-setup.js | manual | warn |
| `agent:claude`, `agent:codex`, `agent:gemini`, `agent:aider`, `agent:opencode` | binaries.js | manual | warn |
| `node`, `npm`, `git` (binarios core) | binaries.js | manual | fail |
| `docker` | binaries.js | manual | warn |
| `serena` | binaries.js | manual | warn |
| `audit-tool:semgrep`, `audit-tool:osv-scanner` | binaries.js | manual | warn |
| `cli:<provider>` × N | tokens.js | manual | fail/warn |
| `mcp:karajan`, `mcp:serena` | mcp-health.js | manual | warn |
| `openskills` | skills.js | manual | warn |
| `rtk` | rtk.js | manual | warn |
| `ollama` | ollama.js | manual | warn |
| `sonarqube` | sonar.js | manual | warn |
| `harness-scorecard` | harness-scorecard.js | none | info |
| `agent-config:claude`, `agent-config:codex`, `agent-config:karajan` | config-files.js | manual | warn |

#### PROJECT (necesitan cwd / projectDir / signals)

| Check | Módulo | Strategy | Severity al fallar |
|---|---|---|---|
| `config` (kj.config.yml o global) | config-files.js | prompt | fail |
| `review-rules`, `coder-rules` | config-files.js | none | info |
| `project:kj-init-ran` | project-checks.js | manual | warn |
| `project:write-perms` | project-checks.js | manual | warn |
| `project:env-consistency` | project-checks.js | manual | warn |
| `project:gh-remote-access` | project-checks.js | manual | warn |
| `port:sonar`, `port:hu-board` | ports.js | auto/auto | warn |
| `token:gh` | tokens.js | prompt | fail |
| `ci:gh`, `ci:secrets` | ci.js | manual | warn |
| `audit-tool:lighthouse` (gatedByStack) | binaries.js | manual | warn |
| `docker (project signal)`, `firebase-cli`, `python3`, `cargo`, `go`, `terraform` | project-checks.js | manual | warn |

#### HYBRID (system check pero el detect lee cwd)

| Check | Módulo | Por qué es híbrido |
|---|---|---|
| `git` (system.js) | Detecta si el `cwd` está dentro de un repo git |
| `config` (config-files.js) | Busca primero en `cwd/.karajan/`, luego en `~/.karajan/` |

### 2.2 Resumen numérico

- **System fijos**: ~24 checks (siempre se corren)
- **System condicionales** (provider CLIs según `config.agents`): 1–5 más
- **Project fijos**: ~9 checks (lifted por `project-checks.js`)
- **Project signal-gated**: 0–6 más (sólo si el signal detecta esa tooling)
- **Hybrid**: 2 checks

Total mostrado en demo "fresca" (sin tooling especializada): **~35 líneas**.

## 3. Fuentes de ruido (false positives en demo)

Estos son los checks que producen **WARN cuando un SKIP sería lo correcto**:

1. **`project:gh-remote-access`** (el del incidente del 21-may).
   - `applies: config?.git?.auto_pr === true` — sólo se filtra por auto_pr.
   - Falta filtro: si el `cwd` no tiene `origin` remote, hacer SKIP, no WARN.
2. **`ci:gh`, `ci:secrets`**.
   - Hoy: siempre corren.
   - Falta filtro: si el proyecto no tiene `.github/workflows/`, SKIP.
3. **`docker`, `sonarqube`**.
   - Hoy: siempre corren.
   - Falta filtro: si `config.sonarqube.enabled !== true`, SKIP (sonar es opt-in).
4. **`mcp:serena`**.
   - Hoy: siempre corre.
   - Falta filtro: si `serena` no está en `config.mcp.servers`, SKIP.
5. **`audit-tool:semgrep`, `audit-tool:osv-scanner`**.
   - Hoy: siempre corren, surfacing missing tools como WARN.
   - Falta filtro: sólo `kj audit` necesita estas herramientas. El usuario
     que sólo corre `kj run` no necesita verlas como WARN. Surfacing en
     `kj doctor` está bien como info (verbose), no como WARN por defecto.
6. **`ollama`**.
   - Hoy: corre siempre.
   - Falta filtro: si la indexación RAG no está configurada para este
     proyecto, SKIP.
7. **Múltiples `agent:<x>`** cuando el usuario sólo usa uno.
   - Hoy: warnings de los 5 agent CLIs (claude/codex/gemini/aider/opencode).
   - Falta filtro: WARN sólo en los agents que `config.agents` realmente usa.
8. **`legacy-kj-home`**.
   - Hoy: WARN si hay `~/.kj/` con entries y no se ha migrado todavía.
   - El propio migrator se autoejecuta al siguiente `kj <cualquier-cosa>`.
   - El WARN no aporta señal — debería ser INFO o SKIP.
9. **`audit-tool:lighthouse`**.
   - Ya gateado por stack (frontend/fullstack). OK.

**Cuenta del incidente**: en un `~/demo/kanban-app` recién creado el
output esperado era "All checks passed" y lo que se vio fue
"1 issue(s) found, 0 auto-fixed, 3 warnings". Los 3 warnings + 1 issue
salían de los apartados 1, 2 y 3 anteriores.

## 4. Opciones de rediseño

### Opción A — Subcomandos por especialidad

```
kj doctor             # = kj doctor all (default, backward compat)
kj doctor system      # sólo SYSTEM checks
kj doctor project     # sólo PROJECT checks (ya existe vía --project-only)
kj doctor all         # todo (alias del default)
```

**Pros**
- Explícito, descubrible con `--help`.
- Comando demo limpio: `kj doctor system` antes de la demo, `kj doctor`
  dentro del proyecto cuando algo se queja.
- Backward compatible: `kj doctor` sigue corriendo todo.

**Contras**
- Tres exit codes que documentar.
- Más superficie en la CLI: TaskCompleter, autocompletes, docs.
- No arregla por sí solo los WARNs falsos — sólo los reparte por buckets.

**Esfuerzo estimado:** ~80 LOC (router en `doctor.js` + 2 subcomandos +
docs).

### Opción B — Flags `--system` / `--project` / `--profile`

```
kj doctor --system
kj doctor --project
kj doctor --profile=demo
kj doctor --profile=ci
```

**Pros**
- Composable: `--system --profile=demo` filtraría por ambas.
- Profiles como macros (e.g. `demo` = "no WARNs opcionales, no signals").

**Contras**
- Mayor cognitive load: dos ejes ortogonales (scope + profile).
- Menos descubrible que subcomandos.
- Flag explosion si se añaden más perfiles después.

**Esfuerzo estimado:** ~120 LOC.

### Opción C — Auto-SKIP vía `applies()` más finos (sin tocar la interfaz)

Cada check declara una precondición real. Cuando no se cumple, el
`runner.js` marca el check `SKIPPED` (status ya existe en `STATUS.SKIPPED`)
y el reporter sólo lo muestra en `--verbose`.

```
kj doctor             # sin SKIPPEDs en el output (default)
kj doctor --verbose   # muestra SKIPPEDs con motivo
```

**Pros**
- Cero breaking changes en la CLI.
- Reduce el ruido del incidente sin que el usuario cambie nada.
- Granular: cada check se mejora independientemente, una task por check.
- Cada commit es ≤30 LOC.

**Contras**
- No ofrece el comando demo limpio "sólo system".
- Algunos `applies()` necesitan I/O (git remote, lectura de
  `.github/workflows/`), lo que aumenta el coste del runner.

**Esfuerzo estimado:** ~10–20 LOC por check × 7 checks ruidosos = ~120 LOC
en total, repartido en 7 PRs atómicas.

### Opción D — Auto-detect profile contextual

`kj doctor` infiere un perfil del entorno y filtra checks:

- En CI (`process.env.CI === 'true'`) → corre todos los checks como hoy.
- En TTY con `git status` limpio y sin tooling instalada → modo "demo"
  (oculta WARNs opcionales).
- En proyecto Karajan dogfooding → modo "dev" (todo).

**Pros**
- Zero-config; usuario no escribe nada distinto.
- Encaja con la filosofía "Karajan must be fully autonomous"
  (`feedback_autonomous_orchestrator.md`).

**Contras**
- La lógica de detección puede equivocarse silenciosamente — usuario no
  sabe por qué un check no apareció.
- Reproducibilidad cuesta: "en mi máquina sale otra cosa".
- Más complejidad oculta que valor.

**Esfuerzo estimado:** ~200 LOC + tests del clasificador.

### Opción E — Combinación A + C (recomendada)

Subcomandos por especialidad **y** `applies()` más finos.

- **Fase 1 (C)**: tighter `applies()` en los 7 checks ruidosos. Resuelve
  el incidente del 21-may sin tocar la interfaz, en commits aislados.
- **Fase 2 (A)**: `kj doctor system` y `kj doctor project` como
  subcomandos explícitos para escenarios donde el usuario sabe qué
  quiere mirar.
- **Fase 3 (opcional)**: `--profile demo` como atajo verboso que oculta
  WARN-level optional checks.

**Pros**
- Cada fase es independiente y entregable por separado.
- Fase 1 sola ya resuelve el incidente con cero riesgo.
- Fase 2 da el comando "limpio para demo en vivo" pedido en el spike.
- Backward compat preservado en todo momento.

**Contras**
- Más tasks que cualquier opción individual.
- Fase 2 puede esperar si Fase 1 ya cierra el incidente.

**Esfuerzo estimado:** Fase 1 ~120 LOC en 7 PRs; Fase 2 ~80 LOC en 1 PR;
Fase 3 ~50 LOC en 1 PR. Total ~250 LOC en 9 PRs.

### Opción F — "no hacer nada" (baseline)

Documentar la limitación, decirle al usuario en demo que prepare un
`kj doctor` previo a la demo en el directorio karajan-code dogfooding y
ya. No es aceptable porque el incidente vuelve a ocurrir al primer
usuario nuevo que arranca un proyecto y corre `kj doctor` en él. La
percepción de "Karajan está roto" es difícil de revertir.

## 5. Matriz de evaluación

Criterios (1 = peor, 5 = mejor):

| Criterio | A | B | C | D | E |
|---|---|---|---|---|---|
| Backward compatibility | 5 | 4 | 5 | 4 | 5 |
| UX en demos | 4 | 3 | 4 | 5 | 5 |
| UX en CI | 4 | 4 | 5 | 3 | 5 |
| Esfuerzo (menos es mejor) | 4 | 3 | 4 | 2 | 3 |
| Cierra el incidente 21-may | 3 | 3 | 5 | 5 | 5 |
| Mantenibilidad | 4 | 3 | 5 | 2 | 4 |
| **Total** | **24** | **20** | **28** | **21** | **27** |

Opción C gana en mantenibilidad y simplicidad; Opción E gana en UX de
demo. Las dos están empatadas en práctica.

## 6. Recomendación

**Opción E (C + A), pero con C delante**.

Razonamiento:

1. **Fase 1 (= Opción C) primero**, porque cierra el incidente del 21-may
   con cambios pequeños, aislados y sin riesgo. Cada PR es ≤30 LOC y se
   mergea independientemente. Si por motivos de tiempo sólo se entregan
   estas 7 PRs, el spike ya cumple su objetivo principal.
2. **Fase 2 (= Opción A) después**, cuando Fase 1 esté en producción y
   se haya validado que el output queda limpio. La subcomanda añade
   ergonomía explícita ("`kj doctor system` para enseñar Karajan a
   alguien nuevo") pero no es estrictamente necesaria para arreglar el
   bug visible.
3. **Fase 3 (`--profile demo`) sólo si**, tras Fase 1 + 2, queda algún
   WARN opcional que el usuario quiera silenciar puntualmente. Es trivial
   de añadir más tarde.

Opción D queda descartada explícitamente: la magia auto-detect
contradice el principio "el usuario tiene que poder reproducir lo que ve".

## 7. Plan de tasks atómicas (≤150 LOC cada una)

Para enganchar a la épica `KJC-PCS-0006` (DevOps & Installer).

### Fase 1 — Tighter `applies()` (Opción C)

| ID propuesto | Título | LOC est. | Depende de |
|---|---|---|---|
| T-1 | `project:gh-remote-access`: SKIP cuando no hay `origin` remote (cierra incidente 2026-05-21) | ~30 | — |
| T-2 | `ci:gh` + `ci:secrets`: SKIP cuando no existe `.github/workflows/` | ~30 | — |
| T-3 | `sonarqube` + `docker`: SKIP cuando `config.sonarqube.enabled !== true` | ~30 | — |
| T-4 | `mcp:serena`: SKIP cuando `serena` no está en `config.mcp.servers` | ~25 | — |
| T-5 | `audit-tool:semgrep|osv-scanner`: degradar WARN a INFO por defecto, surface en `kj audit` y `kj doctor --verbose` | ~40 | — |
| T-6 | `ollama`: SKIP cuando la indexación RAG no está activa en el proyecto | ~30 | — |
| T-7 | `legacy-kj-home`: degradar WARN a INFO (el migrator se autoejecuta) | ~15 | — |

Cada task tiene `applies()` testeable con un fixture mínimo
(`tests/checks/*.test.js`). Independientes entre sí: pueden mergearse
en cualquier orden, pueden paralelizarse.

### Fase 2 — Subcomandos (Opción A)

| ID propuesto | Título | LOC est. | Depende de |
|---|---|---|---|
| T-8 | Router `kj doctor system|project|all` en `src/commands/doctor.js` (reutiliza `--project-only` ya existente). | ~70 | — |
| T-9 | Docs: actualizar `docs/GETTING-STARTED.md` (+ `es/`) con los subcomandos. Landing card si procede. | ~30 | T-8 |

### Fase 3 — Profile (opcional)

| ID propuesto | Título | LOC est. | Depende de |
|---|---|---|---|
| T-10 | `--profile demo` filter: oculta WARN-level optional checks. | ~50 | T-8 |

**Total**: 9–10 PRs, ~250–300 LOC, mergeables incrementalmente.

## 8. Criterios de aceptación del spike

- [x] Inventario completo de checks por scope (sección 2).
- [x] Lista de fuentes de ruido con motivo cada una (sección 3).
- [x] ≥3 opciones comparadas con pros/contras (sección 4: 6 opciones).
- [x] Recomendación justificada (sección 6).
- [x] Lista de tasks atómicas ≤150 LOC para implementar la opción
      ganadora (sección 7).
- [x] Caso de uso del incidente 2026-05-21 documentado (sección 1).

## 9. Out of scope

- Implementación. Este spike entrega análisis + plan; las tasks T-1..T-10
  se ejecutan como cards PG separadas que se enganchan a KJC-PCS-0006.
- Rediseño visual del output (colores, agrupaciones). Si tras Fase 1 el
  output sigue siendo denso, se evaluará en un spike de follow-up.
- Comando `kj doctor --watch`. Fuera del alcance del incidente actual.
