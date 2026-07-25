# Estándares de desarrollo — controles, guardarraíles y hooks

> Documento agnóstico de lenguaje y herramienta. Describe **qué controles** debe
> tener un proyecto de código sano y **por qué**, con ejemplos concretos por
> stack. Sirve como base para redactar el `CONTRIBUTING` de cualquier proyecto,
> sea JavaScript, Python, Go, Rust, Java o PHP.

Principio rector: cada control existe porque su ausencia deja pasar una clase de
error concreta. No se trata de acumular herramientas, sino de cerrar familias de
fallos con el mínimo de fricción.

---

## 1. Las cuatro capas de control

Un cambio de código atraviesa cuatro barreras, de más rápida/local a más lenta/remota.
Cuanto antes se detecta un fallo, más barato es corregirlo.

| Capa | Dónde corre | Velocidad | Ejemplos |
|------|-------------|-----------|----------|
| **1. Editor** | IDE, al escribir | instantáneo | formateo al guardar, LSP, resaltado de errores |
| **2. Pre-commit / pre-push** | máquina del dev, git hook | segundos | formato, lint, tests rápidos, validación del mensaje |
| **3. Integración continua** | servidor CI, por PR | minutos | build, tests completos, cobertura, análisis estático, gates |
| **4. Pre-release** | al publicar/desplegar | minutos | verificación del artefacto real, firma, smoke test |

Regla: **fail-fast**. Lo que se pueda cazar en la capa 2 no debe depender de la
capa 3. Un dev no debería descubrir en CI algo que el hook local podía haber
parado en segundos.

---

## 2. Formateo automático

Elimina las discusiones de estilo y los diffs de ruido. **No es negociable ni
configurable por persona**: una sola configuración en el repo, aplicada por todos.

| Stack | Herramienta |
|-------|-------------|
| JavaScript/TS | Prettier |
| Python | Black / Ruff format |
| Go | `gofmt` / `goimports` |
| Rust | `rustfmt` |
| Java | google-java-format / Spotless |
| PHP | PHP-CS-Fixer |
| Genérico (multi) | EditorConfig (`.editorconfig`) para reglas base: charset, EOL, indentación |

Control: en CI, comando en modo *check* (falla si algo no está formateado).
En local, formateo al guardar o en el hook de pre-commit.

---

## 3. Análisis estático / linting

Caza bugs reales (no solo estilo): variables sin declarar, imports rotos, nulos,
código muerto, patrones inseguros. Prioriza **reglas de alto valor** sobre
"activar todo": un linter demasiado ruidoso se acaba ignorando.

| Stack | Linter |
|-------|--------|
| JavaScript/TS | ESLint (+ typescript-eslint) |
| Python | Ruff / Pylint / mypy (tipos) |
| Go | `go vet` / golangci-lint |
| Rust | Clippy |
| Java | Checkstyle / SpotBugs / PMD |
| PHP | PHPStan / Psalm |

Las tres reglas que más *demos rotas* evitan, en cualquier lenguaje:

1. **Símbolo usado sin declarar/importar** (referencia inexistente).
2. **Import/módulo que no resuelve** (ruta rota).
3. **Nombre importado que no existe** en el módulo destino (typo).

Además, reglas de seguridad de alto valor: prohibir evaluación dinámica de
código (`eval` y equivalentes), ejecución de comandos con entrada sin sanear,
deserialización insegura.

---

## 4. Testing y cobertura

- **Tests unitarios**: rápidos, aislados, la mayoría del volumen.
- **Tests de integración**: varias piezas juntas (BD, API, filesystem).
- **Tests E2E**: flujo de usuario completo (donde aplique).

Reglas:

- Los tests **corren en CI en cada PR** y deben pasar todos.
- Test-first cuando sea viable: escribir/ajustar el test antes del cambio.
- **Cobertura como señal, no como tirano**: mide y vigila tendencia, pero umbrales
  demasiado rígidos bloquean PRs no relacionados. Empieza *advisory*, sube el
  suelo gradualmente. Umbrales orientativos: lógica de negocio y utilidades altas
  (80–90 %), capas de I/O más bajas.

| Stack | Framework habitual |
|-------|--------------------|
| JavaScript/TS | Vitest / Jest · Playwright (E2E) |
| Python | pytest · coverage.py |
| Go | `go test` (built-in) |
| Rust | `cargo test` |
| Java | JUnit · JaCoCo (cobertura) |
| PHP | PHPUnit |

---

## 5. Convención de mensajes de commit

Un historial legible es documentación y permite automatizar changelogs y versiones.

Estándar recomendado: **Conventional Commits** — `tipo(ámbito)?: asunto`.

- Tipos: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Header corto** (≤ ~72–100 caracteres), asunto en minúscula, sin punto final.
- Cuerpo opcional para el *por qué*; líneas envueltas (~100 col).
- El *qué* está en el diff; el mensaje explica el *por qué*.

Se valida en dos sitios: hook `commit-msg` (local) y un check en CI. Reescribir
headers con `--force` sobre ramas ya empujadas es síntoma de mala planificación:
validar el mensaje **antes** de commitear.

---

## 6. Git hooks (guardarraíles locales)

Automatizan las capas 2 del §1. Se pueden gestionar con el gestor nativo del
ecosistema (husky, pre-commit de Python, Lefthook —agnóstico—) o apuntando
`git config core.hooksPath` a una carpeta versionada.

| Hook | Propósito típico |
|------|------------------|
| **pre-commit** | Formatear y lintar lo que se va a commitear. Rápido: solo ficheros staged. |
| **commit-msg** | Validar el formato del mensaje (Conventional Commits, longitud, política). |
| **pre-push** | Correr la suite de tests y un *guard de identidad* (usuario/email configurados) antes de subir. |
| **post-merge / post-checkout** | Refrescar dependencias, índices o caches tras traer cambios. |

Buenas prácticas:

- Los hooks deben ser **rápidos** o los devs los saltarán (`--no-verify`).
- **Versiona** los hooks en el repo (no dependas de configuración manual por máquina).
- Hazlos **idempotentes** y reproducibles; documenta cómo instalarlos.
- El hook local es una comodidad, **no la única defensa**: replica siempre la
  comprobación crítica en CI (un dev puede saltarse el hook; el CI no).

---

## 7. Gates de Integración Continua

Checks que un PR debe pasar antes de fusionar. Marca cuáles **bloquean** y cuáles
son **advisory** (informan sin frenar).

| Gate | Bloquea | Qué garantiza |
|------|:------:|---------------|
| Build / compilación | ✅ | El proyecto compila desde cero. |
| Formato (check) | ✅ | Estilo uniforme. |
| Lint / análisis estático | ✅ | Sin la clase de bugs del §3. |
| Tests | ✅ | Comportamiento correcto. |
| Validación de commits | ✅ | Historial consistente. |
| Cobertura | ⚠️ | Señal de test; sube artefacto. |
| Presupuesto de tamaño (LOC) | ✅ | PRs pequeñas y revisables (§8). |
| Escaneo de secretos | ✅ | Sin credenciales en el diff (§10). |
| Verificación del artefacto | ✅ | Lo que se publica arranca (§9). |
| Dependencias nuevas | ⚠️ | Aviso de nueva superficie de supply-chain. |

Recomendación: **matriz** de versiones/plataformas relevantes (p. ej. dos
versiones de runtime, Linux/macOS/Windows si el proyecto es multiplataforma).

---

## 8. PRs atómicas y presupuesto de tamaño

Los PRs grandes no se revisan bien: el revisor se satura y aprueba a ciegas.

- **Un PR = un propósito** (1 feature, 1 fix o 1 refactor; no mezclar).
- Cada PR debe **compilar y pasar los tests por sí solo**.
- Límite de tamaño recomendado: **≤ ~200 líneas netas** de código (objetivo ~150).
  Se puede automatizar como gate que calcula `añadidas − eliminadas` sobre ficheros
  fuente y falla si supera el límite.
- **La documentación humana no cuenta** para ese presupuesto (README, CHANGELOG,
  `docs/`): que un README crezca no es deuda técnica.
- **Los ficheros de configuración/reglas sí cuentan**: crecen sin control y nadie
  los lee.
- Escape puntual con etiqueta justificada (`large-pr-justified` o similar) para
  casos legítimos (dependencia vendorizada, migración grande), documentado en el PR.

Corolario: si una tarea supera el presupuesto, **particiónala de antemano** en
varios PRs/commits, no la empujes en bloque.

---

## 9. Seguridad de release — verificar el artefacto real

Trampa clásica: **el CI prueba el árbol de trabajo, no el paquete publicado**.
Un artefacto puede pasar todos los tests y aun así estar roto al instalarlo
limpio (dependencias mal declaradas, ficheros que no se empaquetan, rutas rotas).

Guardarraíles:

- **Empaquetar e instalar en un entorno aislado** y ejecutar un *smoke test*
  (que el binario/comando arranque, que importe el paquete). Ejemplos:
  `npm pack` + install limpio · `pip wheel` + install en venv nueva ·
  imagen de contenedor levantada desde cero.
- Enganchar esa verificación como **pre-publicación** (aborta el release si falla)
  **y** como gate de PR.
- Declarar bien la naturaleza de cada dependencia (runtime vs desarrollo vs *peer*).
- Versionado semántico (SemVer) y changelog generado desde los commits.
- **Nunca publicar fiándose solo del CI verde**: verificar el artefacto es un paso aparte.

---

## 10. Guardarraíles de seguridad transversales

- **Secretos fuera del repo**: nunca commitear credenciales, API keys ni ficheros
  de cuenta de servicio. Escaneo de secretos en CI + `.gitignore` estricto +
  gestor de secretos/variables de entorno.
- **Validar y sanear toda entrada externa**: prevención de inyección (SQL, comandos,
  plantillas), XSS, deserialización insegura. Escaneo del diff para patrones peligrosos.
- **Verificación de identidad antes de push/deploy**: confirmar la cuenta activa
  (git, plataforma de hosting, registro de paquetes) — evita mezclar identidades
  y publicar con la cuenta equivocada.
- **Dependencias**: auditoría de vulnerabilidades (`npm audit`, `pip-audit`,
  `cargo audit`, `govulncheck`…) y control de dependencias nuevas.
- **Datos personales fuera de artefactos públicos**: revisar que emails, nombres
  reales o datos privados no acaben en changelogs, READMEs, release notes o logs
  publicados. Tratar cualquier salida pública como un *boundary* a sanear.

---

## 11. Flujo de ramas y Pull Requests

- **Nunca commitear directo a la rama principal.** Todo entra por rama + PR,
  incluso los fixes pequeños. Protección de rama activada en el servidor.
- Naming consistente: `feat/<id>-descripcion`, `fix/<id>-descripcion`.
- Fusión por PR (squash recomendado para un historial limpio); rama efímera,
  borrada tras fusionar.
- Tras fusionar, **sincronizar la rama principal local** con el remoto antes de
  empezar lo siguiente; crear la nueva rama justo después del sync, no antes de tocar ficheros.
- Todo PR: compila, pasa los gates y tiene un único propósito.

---

## 12. Principios de estilo de código (transversales)

- **SOLID, DRY, KISS, YAGNI** como brújula, no como dogma.
- Nombres descriptivos en inglés para símbolos de código.
- Preferir inmutabilidad y APIs modernas del lenguaje sobre construcciones legacy/deprecadas.
- **Sin fallbacks silenciosos**: el sistema funciona o falla de forma visible,
  nunca "a medias" ocultando el error.
- Comentar el *por qué*, no el *qué*; el código legible no necesita glosar cada línea.
- Coherencia con el código circundante por encima de la preferencia personal.

---

## Resumen — checklist mínimo para un proyecto nuevo

- [ ] Formateador configurado + check en CI + `.editorconfig`.
- [ ] Linter/análisis estático con las 3 reglas bug-killer + reglas de seguridad.
- [ ] Suite de tests + cobertura (advisory al principio).
- [ ] Convención de commits validada (hook + CI).
- [ ] Hooks versionados: pre-commit, commit-msg, pre-push.
- [ ] Pipeline CI: build, format, lint, test, cobertura.
- [ ] Gate de tamaño de PR (~200 LOC netas).
- [ ] Escaneo de secretos + auditoría de dependencias.
- [ ] Verificación del artefacto de release (smoke test aislado).
- [ ] Protección de rama principal + flujo por PR.
