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
