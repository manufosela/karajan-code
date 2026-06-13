# Quality Harness — `kj harden` + `kj check` (análisis técnico)

> Estado: ANÁLISIS (H-A, KJC-TSK-0554, épica KJC-PCS-0059). Bloquea los slices H-B..G.
> Fecha: 2026-06-13 · Autor: equipo Karajan

## 1. Objetivo

Destilar los guardrails que hemos aprendido construyendo Karajan en **dos comandos
instalables en cualquier repo** (nuevo o existente):

- **`kj harden`** — *instala* el harness de calidad: git hooks (pre-commit /
  commit-msg / pre-push / post-merge), config de lint/format/commit, workflows
  de CI gateway de calidad, y los ficheros de guidelines para agentes IA.
  No interactivo, idempotente, stack-aware, con perfiles.
- **`kj check`** — *verifica* que lo que `harden` instaló sigue presente y cumple.
  Exit≠0 + reporte accionable. Pensado para local y CI.

Es la versión Karajan del "operator system" de ECC, pero con guardrails
**deterministas y verificables**, no solo prompts.

## 2. Diferenciación de los comandos existentes (no duplicar)

| Comando | Capa | Naturaleza |
|---|---|---|
| `kj doctor` | **entorno** (binarios, puertos, MCP, Docker) | diagnóstico, fix opcional |
| `kj audit` | **calidad del código** (read-only, LLM) | análisis |
| **`kj harden`** | **guardrails del proyecto** | instala/scaffolda |
| **`kj check`** | **compliance del scaffold** | verifica lo que harden puso |

## 3. Inventario de lo que YA existe (consolidar, no reinventar)

| Pieza | Dónde | Reuso en harden/check |
|---|---|---|
| Scaffolding interactivo | `src/commands/init.js` (wizard) | **Extraer el motor** a un módulo compartido; init pasa a usarlo (H-G) |
| Detección de stack | `src/utils/stack-detect.js`, `project-detect.js` | Reuso directo (lenguaje, framework, test-framework, sonar) |
| Hook post-merge | `scripts/git-hooks/post-merge` + `src/rag/auto-update.js::installPostMergeHook` | Patrón marker `KJC-TSK-0455` = **semilla del managed-marker**; harden lo generaliza |
| commitlint | `.commitlintrc.json` (hoy solo CI) | harden instala el hook commit-msg local que lo aplica |
| Anti-atribución IA | `scripts/ai-attribution-guard.yml` (solo CI) | harden lo añade también como check pre-commit local |
| CI gateway/automerge | `templates/workflows/{kj-ci-gateway,automerge,houston-override}.yml` | Orquestación, NO gates de calidad — ver §6 |
| Gates de calidad CI | `.github/workflows/{ci,shrink-budget,pack-smoke}.yml` (solo en este repo) | **Hay que templatizarlos** para que harden los copie (H-D) |
| Verificación de entorno | `src/commands/doctor.js` + `src/checks/*` (--check-only/--json) | **Base de `kj check`** (H-E): wrapper + checks nuevos del scaffold |
| eslint flat config | `eslint.config.js` (scopes src/tests/scripts) | Plantilla base para la config que harden escribe |
| Managed-markers / guidelines | **NO EXISTE** (greenfield) | Diseñar el patrón desde cero (H-F) |

**Conclusión**: cero duplicación si harden compone `stack-detect`, el motor extraído
de `init`, y los templates; y `check` envuelve `doctor`/`checks`. Lo único realmente
nuevo es el **motor de managed-markers** y la **templatización de los gates de CI**.

## 4. Modelo de managed-markers (idempotencia)

Todo fichero que harden gestiona total o parcialmente lleva un bloque delimitado:

```
# >>> kj:managed:<block-id> v<N> >>>   (no editar: regenerado por kj harden)
…contenido gestionado…
# <<< kj:managed:<block-id> <<<
```

Reglas:
1. harden **solo** reescribe el contenido entre markers; **preserva** todo lo de fuera.
2. Re-ejecutar es idempotente (mismo input → mismo bloque, sin duplicar).
3. Sin bloque previo → lo inserta en la posición canónica (p.ej. hooks: tras el shebang).
4. Bloque de versión `v<N>` inferior a la actual → harden lo actualiza y avisa.
5. Comentario sintáctico por tipo de fichero (`#` shell/yaml, `//` js, `<!-- -->` md).

Generaliza el marker `KJC-TSK-0455` ya presente en el post-merge.
Coherente con la regla del usuario "nunca sobrescribir ficheros existentes".

## 5. `kj harden` — superficie

```
kj harden [--profile minimal|standard|strict] [--no-hooks] [--no-ci]
          [--no-guidelines] [--dry-run] [--yes] [--json]
```

- **Stack-aware**: detecta lenguaje/test-framework y adapta config + comandos de hook.
- **Perfiles** (cf `ECC_HOOK_PROFILE`):
  - `minimal`: commit-msg (commitlint) + anti-atribución-IA.
  - `standard` (default): minimal + pre-commit (lint+format del staged) + pre-push (tests rápidos) + post-merge (reindex) + workflows CI básicos + guidelines.
  - `strict`: standard + pre-push con suite completa + cobertura mínima + todos los gates CI (incl. shrink-budget, pack-smoke si publicable).
- **`--dry-run`**: imprime el diff de lo que escribiría sin tocar disco.
- Idempotente vía §4. Respeta config del usuario fuera de los markers.

### Catálogo de guardrails por perfil

| Guardrail | minimal | standard | strict |
|---|:--:|:--:|:--:|
| commit-msg → commitlint | ✓ | ✓ | ✓ |
| anti-atribución-IA (pre-commit + CI) | ✓ | ✓ | ✓ |
| pre-commit lint+format (staged) | | ✓ | ✓ |
| pre-push tests | | rápidos | completos |
| post-merge reindex (si RAG/QMD) | | ✓ | ✓ |
| eslint/prettier/commitlint config | | ✓ | ✓ |
| CI: lint + tests + commitlint | | ✓ | ✓ |
| CI: shrink-budget | | | ✓ |
| CI: pack-smoke (si paquete npm publicable) | | | ✓ |
| guidelines IA (CLAUDE.md/AGENTS.md) | | ✓ | ✓ |

## 6. `kj harden` CI — templatizar los gates reales (H-D)

Hoy `templates/workflows/` solo tiene orquestación (gateway/automerge/houston).
Los gates de calidad viven *hardcodeados* en `.github/workflows/` de karajan-code.
H-D crea `templates/workflows/quality/` con versiones parametrizables por stack:
`lint.yml`, `tests.yml`, `commitlint.yml`, `shrink-budget.yml`, y `pack-smoke.yml`
(solo si el target es paquete npm publicable — detectado por `package.json` sin
`private:true` + `bin`/`main`). harden los copia sin pisar workflows del usuario.

## 7. `kj check` — superficie (H-E)

```
kj check [--profile <p>] [--json]
```

Envuelve la maquinaria de `doctor`/`checks` pero enfocado en **lo que harden instaló**:

- ¿Hooks presentes y ejecutables? ¿Su bloque managed al día (versión)?
- ¿commitlint configurado y el hook commit-msg lo aplica?
- ¿Config de lint/format presente y `lint` pasa?
- ¿Workflows de CI gateway de calidad presentes y actualizados?
- ¿`verify-pack`/`pack-smoke` presentes si el proyecto es paquete publicable?
- ¿Guidelines IA con sus markers íntegros?

Salida: tabla por categoría + exit 0/≠0 + `--json`. Fix accionable: "corre `kj harden`".

## 8. `kj init` reutiliza el motor (H-G)

Extraer de `init.js` un `harden-engine` (instalación de hooks/config/CI/guidelines
con markers). `kj init` (wizard) y `kj harden` (no interactivo) comparten ese motor:
una sola fuente de verdad del scaffolding. `init` añade su capa interactiva +
RTK/Squeezr/QMD/Ollama/Sonar (que NO entran en harden — son entorno, no guardrails).

## 9. Absorber dev-hooks (H-F)

El MCP externo `dev-hooks` hace `init_project` (husky pre-commit/commit-msg/pre-push)
+ `generate_guidelines` (CLAUDE.md/AGENTS.md/Copilot/Codex/Gemini/Cursor con
managed-markers que preservan contenido custom). Karajan no debe depender de un MCP
externo para endurecer un repo: H-F reimplementa esa lógica con el motor de §4,
generando los ficheros de guidelines de agentes a partir de las reglas del proyecto
(reusa `kj.config.yml` + coder-rules/review-rules). Reconoce y migra markers de
dev-hooks ya presentes.

## 10. Slices (≤200 LOC cada uno, patrón Φ0/Φ1)

| Slice | Card | Contenido |
|---|---|---|
| H-A | 0554 | Este análisis |
| H-B | 0555 | `harden-engine` + managed-markers + `kj harden` core (hooks idempotentes + perfiles) |
| H-C | 0556 | Config stack-aware (eslint/prettier/commitlint/.editorconfig) + ES2025 deprecated-API lint |
| H-D | 0557 | `templates/workflows/quality/*` + copia stack-aware (pack-smoke condicional) |
| H-E | 0558 | `kj check` (wrapper doctor/checks + checks del scaffold) |
| H-F | 0559 | Absorber dev-hooks: managed-markers de guidelines IA |
| H-G | 0560 | `kj init` reutiliza el motor + docs/landing |

Orden: H-B (motor+markers) primero → H-C/H-D/H-F en paralelo → H-E → H-G.

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| harden sobrescribe config del usuario | managed-markers (§4) + `--dry-run`; test de idempotencia |
| Hooks no portables (husky vs simple-git-hooks vs core.hooksPath) | usar `core.hooksPath` a `.karajan/hooks/` — no depende de gestor externo |
| Gates demasiado estrictos para proyectos ajenos | perfiles minimal/standard/strict; default standard |
| Divergencia entre los gates de karajan-code y los templatizados | un test que verifica que `templates/workflows/quality/*` cubre los mismos checks que `.github/workflows` del repo |
| pack-smoke en proyecto no publicable | detección publicable (sin `private:true`, con `bin`/`main`) antes de copiarlo |

## 12. Métricas de aceptación

- `kj harden` en repo limpio y en repo con config previa → idempotente, sin pisar nada fuera de markers (test).
- `kj check` exit 0 tras harden; exit≠0 + categoría concreta si se borra un hook o un workflow.
- Stack JS / Python / Go → config y hooks coherentes con cada ecosistema (no imponer JS).
- `kj init` no reimplementa hooks: usa el mismo motor (sin código duplicado, verificado).
- Dogfooding: `kj harden` sobre el propio karajan-code reproduce su harness actual sin regresión.
