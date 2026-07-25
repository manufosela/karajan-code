# Estándares y herramientas de desarrollo — Karajan Code

> Documento de referencia del *harness* de calidad del proyecto. Describe las
> herramientas, hooks y gates que todo cambio de código debe pasar antes de
> llegar a `main`. No cubre el pipeline de orquestación; solo el tooling de
> ingeniería que sostiene la calidad del repositorio.

Última revisión: 2026-07 · Repo: `manufosela/karajan-code` · Versión base: 3.7.x

---

## 1. Requisitos de entorno

| Requisito | Valor |
|-----------|-------|
| Node.js | `>=22.22.1` (matriz de CI: 22.x y 24.x) |
| Gestor de paquetes | npm (lockfile `package-lock.json`); pnpm soportado para instalar/arrancar |
| Módulos | ESM (`"type": "module"`) — `import/export`, nunca `require` |
| Instalación limpia | `npm ci` |

Node 20 se retiró en la v3.0.0 (EOL 2026-04-30 y dependencias que exigían el salto).

---

## 2. Estilo de código

### 2.1 ESLint (`eslint.config.js`, flat config)

Filosofía: **baseline mínimo que mata la clase de bug que tira una demo**, no un
linter maximalista. Tres reglas son *hard-fail* en todo `src/**` y `tests/**`:

- `no-undef` — símbolo usado sin declarar/importar.
- `import-x/no-unresolved` — ruta de import que no resuelve (built-ins `node:` exentos).
- `import-x/named` — import con nombre que no existe en el módulo destino (caza typos).

Política de código inseguro (reglas de alto valor de `eslint-plugin-security`):

- `no-eval`, y bloqueo de `new Function`, `child_process` con literal dinámico, etc.
- Prohibido reintroducir `globalThis.__KJ_*` fuera de `src/config/test-harness.js`.
- `no-console` **error** en la capa de librería/orquestador; permitido solo en
  `src/commands/**`, utilidades de display, el logger y los drivers que imprimen
  banners de usuario.

El resto (formato, `no-unused-vars`) es `warn`, no bloquea.

```bash
npm run lint        # eslint src/
npm run lint:fix    # autofix
```

### 2.2 Prettier (`.prettierrc.json`)

| Opción | Valor |
|--------|-------|
| `semi` | `true` |
| `singleQuote` | `false` (comillas dobles) |
| `trailingComma` | `es5` |
| `printWidth` | `100` |
| `tabWidth` | `2` (espacios, sin tabs) |
| `arrowParens` | `always` |
| `endOfLine` | `lf` |

```bash
npm run format:check   # prettier --check .
npm run format:fix     # prettier --write .
```

### 2.3 Sintaxis a nivel de parseo

`node --check` sobre todos los `.js` de `src/` y `tests/` — caza errores de
sintaxis/import en tiempo de parseo antes que cualquier test.

```bash
npm run lint:syntax
```

### 2.4 Reglas de lenguaje (resumen)

- ES2025 como objetivo; APIs deprecadas prohibidas aunque "funcionen".
- `const` por defecto, `let` solo cuando haga falta; nunca `var` en código nuevo.
- Arrow functions para callbacks, template literals para interpolación.
- Sin fallbacks silenciosos: el sistema funciona o falla, nunca a medias.
- TypeScript de tipado: `npm run typecheck` (`tsc --noEmit`).

---

## 3. Convención de commits

**Conventional Commits** obligatorio, validado tanto en local (hook `commit-msg`)
como en CI (`commitlint`).

- Formato del header: `type(scope)?: subject`
- Tipos permitidos: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
  `refactor`, `revert`, `style`, `test`.
- **Header ≤ 100 caracteres** (regla dura).
- `subject` en minúscula, sin punto final.
- **Prohibida cualquier atribución a herramientas automáticas** en el mensaje
  (el hook lo rechaza).
- Reescribir headers con `--force` sobre una rama ya empujada es un síntoma de
  mala planificación: contar caracteres **antes** de commitear.

Config: `.commitlintrc.json` (extiende `@commitlint/config-conventional`).

---

## 4. Git hooks locales

Los hooks viven en `.karajan/hooks/` y se activan con `core.hooksPath`. Están
gestionados con marcadores idempotentes `# >>> kj:managed:<id> v<N> >>>` — no
editar el bloque gestionado a mano; se regenera.

| Hook | Qué hace |
|------|----------|
| **pre-commit** | `npm run lint` + `npm run format:check`. Falla → aborta el commit. |
| **commit-msg** | Valida Conventional Commits, header ≤100, y bloquea atribuciones automáticas. |
| **pre-push** | Exige `user.name`/`user.email` configurados (guard de identidad) y ejecuta `npm test`. Falla → no hay push. |
| **post-merge** | Refresca el índice local de búsqueda tras un merge (no bloquea). |

> Guard de identidad: antes de cualquier push/deploy, confirmar la cuenta activa
> (`git config user.email`, `gh auth status`, `npm whoami`). Previene mezclar
> identidades entre proyectos.

---

## 5. Testing

- **Framework unit/integración:** Vitest 4 (`vitest.config.js`).
- **E2E:** Playwright (donde aplica) + workflow de instalación E2E en CI.
- Ejecución en *forks* (varios tests hacen `process.chdir()`, que rompe en worker threads).
- Timeout por defecto: 120 s (tests de integración multi-etapa).

```bash
npm test                # vitest run
npm run test:watch      # modo watch
npm run test:coverage   # cobertura v8 (text + html + lcov)
```

### Cobertura (v8) — umbrales por directorio

La cobertura genera señal, **no es gate bloqueante** todavía (corre con
`continue-on-error` en CI). Umbrales configurados:

| Área | Líneas / Funciones |
|------|--------------------|
| `src/agents/**` | 80 / 80 |
| `src/mcp/handlers/**` | 70 / 60 |
| `src/session/journal/**` | 70 / 70 |
| Resto (default) | 40 / 40 |

El paquete `packages/hu-board` trae su propia suite y se ejecuta aparte en CI.

---

## 6. Análisis estático — SonarQube

- Config: `sonar-project.properties` (`projectKey=karajan-code`).
- Fuentes en `src/`, tests en `tests/`, informe de cobertura desde
  `coverage/lcov.info`.
- Exclusiones: `node_modules`, `dist`, `build`, `coverage`.
- SonarQube corre en Docker local; análisis manual con `npx @sonar/scan`
  (requiere el contenedor arrancado).
- Objetivo: cero *code smells*, bugs o vulnerabilidades nuevos; quality gate en verde
  antes de commitear cambios de código.

---

## 7. Gates de Integración Continua

Todo PR a `main` pasa por estos checks (`.github/workflows/`):

| Check | Workflow | Bloquea | Qué verifica |
|-------|----------|:------:|--------------|
| **Syntax** (Node 22/24) | `ci.yml` | ✅ | `node --check` de todos los `.js`. |
| **Lint** (Node 22/24) | `ci.yml` | ✅ | ESLint (`no-undef` + resolución de imports). |
| **Format** | `ci.yml` | ✅ | `prettier --check`. |
| **Commit messages** | `ci.yml` | ✅ | commitlint sobre los commits del PR. |
| **Test** (Node 22/24) | `ci.yml` | ✅ | Suite Vitest (raíz + `hu-board`). |
| **Coverage (v8)** | `ci.yml` | ⚠️ | Cobertura; sube artefacto. Advisory. |
| **Net LOC delta** | `shrink-budget.yml` | ✅ | Presupuesto de LOC (ver §8). |
| **New dependencies** | `shrink-budget.yml` | ⚠️ | Avisa de deps nuevas. Advisory. |
| **Pack Smoke** | `pack-smoke.yml` | ✅ | El tarball publicable instala y arranca (ver §9). |
| **Injection Guard** | `injection-guard.yml` | ✅ | Escanea el diff del PR en busca de patrones de inyección. |
| **E2E Install** | `e2e.yml` | ✅ | Instala global en Linux/macOS/Windows y verifica el CLI. |

---

## 8. Presupuesto de LOC — PRs atómicas

Regla dura del repo (`shrink-budget.yml`), tras detectar +47 % de LOC en 4 semanas:

- **Delta neto (añadidas − eliminadas) ≤ 200 líneas** por PR sobre ficheros fuente.
- Objetivo práctico: **~150 LOC** de margen contra el límite.
- Los **tests cuentan**.
- **Documentación humana NO cuenta**: `README*.md`, `CHANGELOG.md`, `docs/**`
  (`.md`/`.mdx`/`.txt`/`.rst`), `CONTRIBUTING.md`, `SECURITY.md`, `MIGRATION*.md`, `TODO*.md`.
- **Ficheros de reglas para el tooling SÍ cuentan** (p. ej. `CLAUDE.md`,
  `AGENTS.md`, `templates/**/*.md`): entran en el contexto de las herramientas
  cada ejecución, así que se les aplica la misma disciplina.
- Otras exclusiones: lockfiles, `*.snap`, `dist/**`, `node_modules/**`,
  `*.min.js`, `tests/_diet/**`, `public/docs/**`.
- Escape puntual: etiqueta `large-pr-justified` en el PR (usar con moderación y
  justificar en el cuerpo). Deps nuevas: etiqueta `new-dep-approved`.

Corolario: si una tarea claramente supera ~150 LOC, **particiónala de antemano**
en varios PRs/commits atómicos. Un PR = un solo propósito (1 feature, 1 fix,
1 refactor), y debe compilar y pasar tests por sí solo.

---

## 9. Seguridad de empaquetado (publicación)

Tres versiones (3.2.0 / 3.3.0 / 3.4.1) se publicaron rotas: pasaban el CI pero no
arrancaban ni `kj --version` porque el CI probaba el *workspace* enlazado, no el
tarball real. Red de seguridad resultante:

- **`scripts/verify-pack.mjs`**: hace `npm pack`, instala el tarball aislado (sin
  variables de entorno del entorno de desarrollo) y verifica que el binario arranca
  y que las deps resuelven.
- Enganchado como **`prepublishOnly`** → `npm publish` **aborta** si el tarball no arranca.
- Workflow **Pack Smoke** en cada PR → mismo check antes del merge.
- Regla operativa: **nunca publicar fiándose del CI verde**; `verify-pack` es
  obligatorio. Las deps de runtime de `packages/*` van como `peerDependencies`
  (no se bundlean).

```bash
npm run verify-pack   # local, antes de publicar
```

---

## 10. Flujo de ramas y Pull Requests

- **Nunca commitear directo a `main`.** Siempre rama + PR, incluso para fixes pequeños.
- Naming: `feat/{ID}-descripcion-corta` para features, `fix/{ID}-descripcion-corta` para bugs.
- Todo se mergea a `main` por PR (squash). Rama efímera, borrada tras el merge.
- Tras cada merge, **sincronizar `main` local**: `git checkout -B main origin/main`
  (el filesystem local debe reflejar `origin/main`). Crear la siguiente rama
  **inmediatamente después** del sync, antes de tocar ficheros.
- Cada PR debe: compilar, pasar todos los gates, y tener un único propósito.

---

## 11. Cheatsheet de comandos

```bash
# Calidad local (equivalente a los gates principales)
npm run validate        # lint + lint:syntax + test
npm run lint            # ESLint
npm run format:check    # Prettier (check)
npm run lint:syntax     # node --check
npm test                # Vitest
npm run test:coverage   # Vitest + cobertura v8
npm run typecheck       # tsc --noEmit

# Empaquetado / publicación
npm run verify-pack     # pack + install aislado + arranque del binario

# SonarQube (requiere Docker arrancado)
npx @sonar/scan
```

---

## 12. Cómo se instala y mantiene el harness

El conjunto de hooks, config (ESLint/Prettier/commitlint/editorconfig) y
workflows de CI se instala y actualiza de forma idempotente con la herramienta
de *hardening* del proyecto (`kj harden`). Usa marcadores gestionados
(`# >>> kj:managed:<id> v<N> >>>`) para actualizar solo su propio bloque sin
tocar el contenido que hayas añadido tú. Para revisar la deriva sin aplicar
cambios existe el modo de solo lectura (`kj check` / `kj harden --report`).

---

### Resumen de principios

1. **Simple y de alto valor**: cada regla existe porque un bug concreto pasó sin ella.
2. **Fail-fast local**: los hooks paran el problema antes de que llegue a CI.
3. **Todo verde antes de avanzar**: un fallo (aunque sea cosmético) se arregla antes del siguiente paso.
4. **PRs atómicas y pequeñas**: ≤200 LOC netas, un propósito, compila y pasa sola.
5. **Nunca publicar a ciegas**: el artefacto real se verifica, no solo el workspace.
