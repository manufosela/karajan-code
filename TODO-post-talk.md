# Post-talk backlog (post 2026-05-21)

Findings de un code review pre-charla del ciclo v2.10.0 (PRs #605–#611).
Lo crítico para la demo se arregló en el PR #613. Esto es lo que NO
afecta al directo y se puede tocar después con calma.

## P1 — Bugs latentes con impacto real

### P1-1 · `kj board start --bind 0.0.0.0` — la UI del navegador no funciona desde otra máquina

**Ficheros**: `packages/hu-board/public/app.js:46` (función `api`) + `packages/hu-board/src/server.js:185–191`.

**Problema**: cuando el board se bindea no-loopback, el banner imprime
`http://192.168.x.x:4000/?token=XYZ`. El HTML carga (estático, sin auth),
pero `api()` hace `fetch(path)` sin propagar token ni credenciales. Cada
GET a `/api/dashboard`, `/api/projects`, etc. devuelve 401. El cookie
`kj_board_token` documentado en el mensaje de error tampoco funciona
porque el server no envía `Set-Cookie` en ningún momento.

**Resultado**: `--bind 0.0.0.0` carga la cáscara del board pero está
vacía de datos. Feature inservible para usuarios LAN.

**Fix sugerido (XS)**: en `app.js`, leer `?token=` de
`window.location.search` en el primer `api()` y guardarlo en
`localStorage`; añadirlo a cada request como `Authorization: Bearer`.
Alternativa: el server emite `Set-Cookie: kj_board_token=...; SameSite=Lax`
cuando valida el token por primera vez vía query.

**Demo**: NO afecta — el demo usa loopback, donde la auth está
desactivada por design.

---

### P1-2 · `parseLighthouseReport` devuelve `ok:true` con métricas null

**Ficheros**: `src/webperf/scanner.js:131–151` + `src/webperf/cwv-gate.js:67–88`.

**Problema**: si lighthouse devuelve JSON válido pero shape inválido
(error envelope, schema futuro, truncado), `evaluateCwv` salta los
metrics null, devuelve `pass: true` con todo vacío y el perf gate pasa
silently sin haber medido nada.

**Fix sugerido (S)**: guard en `parseLighthouseReport` — si
`report?.categories?.performance` no está, devolver
`{ ok: false, reason: "lighthouse report missing performance category" }`.

**Demo**: NO afecta directamente — perf gate es opt-in y no se
demuestra.

---

### P1-3 · `stripFencedCodeBlocks` falla en fences sin newline antes del cierre

**Fichero**: `src/audit/agent-readiness.js:181`.

**Problema**: el regex requiere `\n\1\2[^\n]*$`. Un fence cuya última
línea de contenido no termina con newline antes del cierre no se
elimina. Si dentro hay `# comment`, cuenta como H1 falso positivo.

**Reproducción**:
```
\`\`\`bash
# comment
foo\`\`\`   ← no \n antes del cierre
```

**Fix sugerido (XS)**: cambiar `([\s\S]*?)\n\1\2[^\n]*$` por
`([\s\S]*?)(\n\1\2[^\n]*|)\s*$` o normalizar trailing whitespace antes
del match.

**Demo**: NO afecta — Karajan-on-Karajan sigue 100/100. Riesgo en
auditorías a repos de terceros con esta forma rara.

---

### P1-4 · `htmlH1Count` matchea `<h1>` dentro de comentarios HTML

**Fichero**: `src/audit/agent-readiness.js:112`.

**Problema**: el regex `/<h1[\s>]/gi` se aplica DESPUÉS de stripear
fenced code blocks, pero NO strippea comentarios HTML. Un doc con
`<!-- <h1>Title</h1> -->` + un H1 markdown real cuenta 2 H1s y se marca
como violación.

**Fix sugerido (XS)**: strip comentarios HTML antes del regex —
`text.replace(/<!--[\s\S]*?-->/g, "")`.

**Demo**: NO afecta — ningún doc actual de Karajan tiene `<h1>` dentro
de comentarios.

---

## P2 — Code quality / edge cases

### P2-1 · Race condition en `getOrCreateToken()`

**Fichero**: `packages/hu-board/src/token-store.js:38–57`.

**Problema**: `existsSync` + `writeFileSync` es TOCTOU. Si dos board
processes arrancan simultáneamente, ambos generan token diferente, gana
el segundo en escritura, el primero queda con `process.env.HU_BOARD_TOKEN`
desfasado y todos sus auth checks fallan.

**Mitigación actual**: el PID-file check de `kj board start` evita el
spawn paralelo. Ventana de race muy estrecha.

**Fix sugerido (XS)**: `writeFileSync(..., { flag: "wx" })` con
fallback a `readFileSync`.

---

### P2-2 · CSP con `unsafe-inline` en script-src y style-src

**Fichero**: `packages/hu-board/src/server.js:89–90`.

**Problema**: necesario para el inline JS/CSS actual del dashboard.
El comentario lo marca como follow-up. Cero vector XSS hoy. Riesgo
materializa solo si el board se expone a LAN y hay XSS almacenado en
session data.

**Fix sugerido (M, deferido)**: mover `<script>` y `<style>` inline a
ficheros externos. Solo urgente si se promociona `--bind 0.0.0.0`.

---

### P2-3 · Doble invocación de `authMiddleware` en `/api/pipeline`

**Fichero**: `packages/hu-board/src/server.js:152–153`.

**Problema**: `app.use('/api', auth, ...)` + `app.use('/api/pipeline', auth, ...)`
hace que las requests a `/api/pipeline/*` pasen por `authMiddleware`
dos veces. Sin impacto funcional, ~doble overhead en el polling.

**Fix sugerido (XS)**: eliminar el `authMiddleware()` del segundo mount
(ya cubierto por `/api`), o mover `pipelineRoutes` dentro de `apiRoutes`.

---

## Test gaps importantes

### TG-1 · No hay e2e que valide el demo script literal

Sólo se cubre paso 1 con tmp dir. Pasos 2–5 + el pipe a jq quedan sin
red de seguridad. Debería existir un test que ejecute SECUENCIALMENTE
los comandos exactos de `docs/demos/agent-readiness.txt` y asserte que
cada uno exit 0 y stdout parseable.

**Sugerencia**: extender `tests/e2e/07-kj-audit.test.js` con un test que
ejecute todas las invocaciones encadenadas. Esfuerzo: S.

---

### TG-2 · `kj run` zero-config en dir totalmente vacío sin testear e2e

Todos los e2e existentes usan `makeTmpProject()` que pre-inicializa
git + `.karajan/`. El path `autoInit` real (sin git, sin nada) sólo se
testea con `runCommand` mockeado en `tests/bootstrap.test.js`.

**Sugerencia**: nuevo `tests/e2e/02-run-zero-config.test.js` que llame
a `runKj(["run", "..."], { cwd: emptyDir })` con coder fake y verifique
git repo + .gitignore creados. Esfuerzo: M.

---

### TG-3 · Cadena `enablePerf` MCP→CLI→config sin red de tests

`enablePerf: true` en MCP → sovereignty-guard → `runKjCommand` →
`--enable-perf` → `applyRunOverrides` → `pipeline.perf.enabled`. Cero
test cubre la cadena completa. Si en una limpieza de dead exports se
cae el entry de `PIPELINE_ENABLE_FLAGS`, el perf gate nunca se activa
y nadie se entera.

**Sugerencia**: 1 test en `tests/config.test.js` (sección
`applyRunOverrides`) + 1 en `tests/mcp-tools-schema.test.js`.
Esfuerzo: XS.

---

### TG-4 · Lighthouse JSON corrupto sin cubrir en scanner

`tests/webperf/scanner.test.js` cubre ENOENT, killed, exit code ≠ 0,
pero no `JSON.parse` failure de stdout válido pero garbled.

**Sugerencia**: 1 `it` que mockee `execFile` con `"not json"` y verifique
`{ ok: false, reason: /not parseable/ }`. Esfuerzo: XS.

---

### TG-5 · `--bind 0.0.0.0` testeado solo via mock, no socket real

`auth.test.js` simula peer no-loopback con un middleware que sobreescribe
`req.ip`. No hay test que de verdad bindee Express en un puerto real y
haga una request HTTP TCP.

**Sugerencia**: integration test en `packages/hu-board/tests/auth.test.js`
con `app.listen(0)` + request real. Esfuerzo: S.

---

### TG-6 · Drift de versión README/GETTING-STARTED vs package.json sin guard CI

El historial muestra que ha pasado: en v2.7.0 quedaron en v2.6.x sin
detectarse. Hoy ambos en 2.10.0, OK. Pero el siguiente bump puede
volver a romperlo.

**Sugerencia**: 1 snapshot test en
`tests/architecture/agent-readability.test.js` que compare las strings
de versión en `README.md` línea 26 y `docs/GETTING-STARTED.md` con
`package.json`. Esfuerzo: XS.

---

## Hallazgos del Nivel 3 testing — `kj run` trivial (2026-05-07)

### N3-1 · Pipeline crea DOS commits en vez de uno (post-pipeline duplica el del coder con prefix `feat:`)

**Repro**: `kj run "Add a JSDoc comment to index.js"` (taskType=`doc`).
Tras un solo run, `git log --oneline` muestra:

```
98b1059 (HEAD) feat: Add a JSDoc comment to index.js explaining what it exports
2d770aa         docs: add JSDoc comment to index.js explaining module exports
8a95ef0         initial
```

El **coder** crea correctamente `2d770aa` con prefix `docs:`. Pero el
**audit/post-pipeline** añade un segundo commit `98b1059` con prefix
`feat:` que duplica el cambio (o lo confirma con un re-commit).

Dos problemas:
1. Tener 2 commits para un solo cambio es ruido en `git log`. Si
   ejecutas `git diff 8a95ef0..98b1059` el cambio neto es solo el
   JSDoc.
2. El segundo commit usa `feat:` para una tarea `doc` — además de
   redundante, viola la convención.

**Sospecha**: hay un commit del coder + un commit del post-loop
("Committed changes" que aparece en el log: `06:34:10.664 Committed
changes`). Ese segundo commit no debería existir cuando el coder ya
hizo el suyo, o si existe debería ser un `--amend` o respetar el
taskType para el prefix.

**Fix sugerido (S)**: en `src/orchestrator/drivers/post-loop.js` (o
donde esté la línea "Committed changes"), detectar si el coder ya
hizo `git commit` y, si es así:
- skipear el commit duplicado, **o**
- hacer `git commit --amend` para enriquecer el message preservando
  el prefix del coder, **o**
- fusionar diff cuando sea seguro.

**Demo**: SÍ afecta — si en directo enseñas `git log --oneline` tras
una run, la audiencia ve dos commits casi idénticos y se queda con
cara rara. **Mitigación pre-charla**: investigar y arreglar, o
dejar el demo en `git log -1` (último commit solo).

### N3-2 · addyosmani-catalog git pull falla por force-push upstream

**Repro**: cualquier `kj run`. Ver línea:

```
addyosmani-catalog: git pull failed — Desde https://github.com/addyosmani/agent-skills
 + 1f66d57...742dca5 main → origin/main  (actualización forzada)
fatal: No es posible hacer fast-forward, abortando. (keeping stale cache)
```

El upstream addyosmani/agent-skills hizo force-push. Mi sync local
intenta fast-forward y falla. El cache stale se mantiene como fallback,
pero el catálogo queda desactualizado hasta que alguien lo arregle a mano
(`git fetch + git reset --hard origin/main`).

**Fix sugerido (S)**: en `src/skills/addyosmani-sync.js` (o donde esté
el sync), capturar el error de fast-forward y hacer `git fetch && git
reset --hard origin/main` automáticamente. El cache es un mirror del
upstream, no nuestro fork — es seguro.

**Demo**: si ejecutas `kj run` en directo y la audiencia ve "addyosmani-
catalog unavailable", queda mal. **Mitigación pre-charla**: ejecutar a
mano `cd ~/.karajan/skills/addyosmani && git fetch && git reset --hard
origin/main` la noche del 20 mayo.

### N3-3 · `kj init` sigue escribiendo `sonarqube.enabled` (deprecated desde v2.7.4)

**Repro**: tras ejecutar `kj init` reconfigure el 2026-05-06 (con el
wizard expandido del PR #616), el siguiente `kj run` emite:

```
DEPRECATED: `sonarqube.enabled` in kj.config.yml is ignored since
v2.7.4. Sonar is intrinsic to Karajan for code tasks ... Remove the
key from your config to silence this warning.
```

El wizard sigue preguntando "Enable SonarQube analysis?" y guardando
`sonarqube.enabled: true|false`. La policy desde v2.7.4 lo ignora.
Hay que limpiar el wizard.

**Fix sugerido (XS)**: en `src/commands/init.js`:
- Eliminar el prompt "Enable SonarQube analysis?".
- En su lugar, decir al usuario "Sonar is intrinsic to Karajan for
  code tasks (sw / refactor / add-tests). Configure the token via
  the bootstrap below."
- El bootstrap del token ya se ejecuta sí o sí.

**Demo**: si la audiencia copia tu config tras ver `kj init`, hereda
el warning. Cosmética pero rascable.

### N3-4 · Audit final reporta "Missing git remote.origin.url" como warning en repos locales

**Repro**: cualquier `kj run` en un dir git nuevo sin remote. El audit
final emite:

```
sonar audit input: getOpenIssues failed: Missing git remote.origin.url.
Configure remote origin or set sonarqube.project_key explicitly.
```

Esto es esperable (sin remote no hay project_key automático). Pero se
reporta como warning visible al usuario, dando la impresión de error.

**Fix sugerido (XS)**: detectar `remote not configured` en el sonar
input collector y devolver `not applicable` en lugar de `failed`. Igual
que ya hacen los otros best-effort scanners (osv, semgrep) cuando faltan.

**Demo**: si en directo ejecutas `kj run` en `/tmp/kj-demo` (sin
remote), la audiencia ve un warning que parece error.

---

## Bug menor del wizard expandido (post v2.10.2)

### Sonar admin password rotation falla silenciosamente

**Ficheros**: `src/sonar/token-bootstrap.js:101–127`.

**Problema**: tras lanzar `kj init` reconfigure el 2026-05-07, el token
se generó correctamente (`~/.karajan/sonar.token` mode 0600, 44 bytes,
y `kj audit --deterministic-only` ya consume issues reales en lugar
de devolver 401). Pero la rotación de la password admin NO ocurrió:
**no existe `~/.karajan/sonar.admin-password`**. Eso significa que
`admin/admin` sigue funcionando en el Sonar local.

Causa probable: el `change_password` devuelve un status que mi código
trata como "non-fatal — probably the admin already changed the password"
y sigue silenciosamente con admin/admin. Cuando luego `revoke` y
`generate` funcionan (admin/admin SÍ es la pass actual), el resultado
es éxito visible (token guardado) pero rotación silenciosamente
saltada.

**Fix sugerido (XS)**: en el `else if (change.status !== 0 && change.status !== 401)`
branch, loggear warning con el status y body recibidos para que el
usuario sepa que la rotación se saltó. Y considerar reintentar con
detalle. Alternativa: si la rotación falla pero admin/admin sigue
funcionando para revoke+generate, persistir la default `admin` como
"current admin pass" en `sonar-credentials.json` para que futuros
runs sepan que la pass sigue siendo default.

**Demo**: NO afecta — Sonar es local, loopback, contenedor del
usuario. Riesgo de seguridad nulo durante la charla.

---

## UX — wizard de instalación incompleto (KJC-TSK-0367)

### `kj init` solo cubre el 30% de la configuración necesaria

**Problema**: el wizard actual (9 prompts) deja fuera lo más importante:

- **Provider para los otros 11 roles** (planner, researcher, architect, refactorer, tester, security, solomon, impeccable, perf, brain, hu_reviewer). Hoy todos heredan del coder; no se puede pedir "tester con gemini, security con codex" sin editar el yml.
- **Token de Sonar**: el wizard solo imprime instrucciones manuales para abrir `localhost:9000`, login admin/admin, generar token. Debería hacerlo via API REST (`POST /api/user_tokens/generate`).
- **`auto_commit / auto_push / auto_pr`**: hoy quedan en defaults silenciosos. En el demo del 21 mayo tuvimos que añadir `--auto-commit` al flag a mano para que `git log` enseñara commits.
- **HU Board bind** (loopback vs `0.0.0.0` con token autogen) — la feature de seguridad del v2.10 (#607) no se expone en el wizard.
- **Brain on/off, Solomon on/off** — hoy son defaults tácitos; falta poder elegirlos explícitamente.

**Esfuerzo estimado**: ~400 LOC en `src/commands/init.js` + `src/sonar/token-bootstrap.js` (nuevo) + tests. **3-4 horas**, 1 sesión.

**Card en PG**: `KJC-TSK-0367` con plan de 7 pasos + 6 acceptance criteria.

**Riesgo**: medio (wizard interactivo, hay que probarlo a mano además de tests con wizard mockeado). No afecta al demo del 21 mayo, solo al setup de máquinas nuevas.

---

## Plan recomendado

**Sprint inmediato post-charla** (1–2 días):
1. P1-1 (HU board cookie) — feature está rota para el caso de uso anunciado.
2. TG-1 + TG-2 (e2e demo + e2e run zero-config) — red de seguridad para
   futuras releases.
3. TG-6 (version drift guard) — barato, evita la próxima vergüenza.

**Sprint medio plazo** (1 semana):
4. P1-2, P1-3, P1-4 (regex + scanner edge cases) — todos XS.
5. TG-3, TG-4, TG-5 — cubren los huecos de paridad.

**Backlog deferido**:
6. P2-1, P2-2, P2-3 — calidad pero sin urgencia.

## Cómo se ha generado este documento

Code review automatizado el 2026-05-06 con la skill `code-review` de
Claude Code, ejecutada con 3 agentes Sonnet en paralelo (bug scan,
test gaps, demo pre-flight). El showstopper detectado se arregló en
PR #613 antes de tocar este backlog. Volver a ejecutar el review
después de cada release mayor.
