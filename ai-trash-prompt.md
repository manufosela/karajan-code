# Implementar `ai-trash`: red de seguridad para acciones destructivas de IA

## Contexto del problema

Los guardarraíles tradicionales para CLIs agénticos (Claude Code, Cursor, Aider, Gemini CLI) consisten en **deny lists** de comandos peligrosos (`rm -rf`, `git push --force`, `DROP DATABASE`, etc.). Son seguros pero asfixian la autonomía de la IA: cada operación destructiva razonable requiere confirmación manual del humano.

Quiero invertir el modelo: dejar que la IA ejecute acciones destructivas, pero **interceptar cada una y guardar un snapshot en una papelera que la IA NO puede tocar**. Si rompe algo, restauramos. Si no rompe nada, la papelera se purga por TTL. Solo el humano puede vaciar la papelera.

Es el patrón **"copy-on-destroy with quarantine"** — equivalente a un `undo log` de base de datos aplicado al workflow de IA agéntica.

## Tu misión

Implementar este sistema como **paquete nuevo dentro del monorepo de karajan-code**, con dos modos de uso:

1. **Como parte de karajan** (siguiendo las convenciones existentes del monorepo).
2. **Instalable y usable de forma independiente**, sin acoplamiento innecesario al resto de paquetes.

El nombre del paquete lo decides tú según el naming del monorepo (`ai-trash`, `kj-trash`, `karajan-safe-net`, etc.).

## Decisiones de diseño YA tomadas — NO re-deliberar

### Flujo

```
IA ejecuta acción destructiva
       │
       ▼
┌──────────────────────────────────────┐
│ Hook PreToolUse del CLI agéntico     │
│  1. Clasifica acción                 │
│  2. Genera snapshot a papelera       │
│  3. Snapshot OK → deja pasar         │
│     Snapshot KO → BLOQUEA (fail-closed) │
└──────────────────────────────────────┘
       │
       ▼
  Comando real ejecuta
```

### Papelera

- Ubicación configurable (defaults razonables: `/var/lib/ai-trash/` system-wide o `~/.local/share/ai-trash/` por usuario).
- Propiedad: **diferente owner/grupo que la IA**, o bind-mount read-only desde container, o filesystem WORM.
- Estructura: una carpeta por incidente con `id` corto + timestamp.
- Cada entrada incluye manifest JSON con: comando interceptado, cwd, sesión, timestamp, tipo de snapshot, ruta original, comando de restauración, TTL.
- Log append-only (`chattr +a` o equivalente) de cada operación.

### Comandos expuestos

| Subcomando | Quién |
|------------|-------|
| `add` (interno, lo llama el hook) | hook / IA indirectamente |
| `list` | humano + IA |
| `inspect <id>` | humano + IA |
| `restore <id>` | humano + IA |
| `empty` / `purge` | **SOLO humano**, requiere sudo / password / factor externo |

La IA puede ver y restaurar; **jamás** vaciar.

### Snapshotters del MVP (solo 3 verbos)

1. **Ficheros/dirs**: `rm`, `rm -rf`, truncado con `>`, `mv` sobreescribiendo → mover/copiar a papelera. Usar `mv` mismo-FS, reflinks CoW (btrfs/APFS/ZFS) cuando esté disponible.
2. **Git destructivo**: `git reset --hard`, `git push --force`, `git branch -D`, `git clean -f` → `git bundle create` previo + tag local del HEAD perdido.
3. **SQL destructivo**: `DROP TABLE/DATABASE`, `TRUNCATE`, `DELETE FROM ... WHERE` → `pg_dump`/`mysqldump` previo. Motor detectado por env var/config.

El core debe ser **extensible**: añadir un cuarto tipo (Docker, S3, kubectl) = añadir módulo, no tocar core.

### Integración con CLIs

- **Obligatorio MVP**: adapter para Claude Code (hook bash PreToolUse + snippet de `settings.json`).
- **Diseño del binario**: interfaz JSON stdin/stdout, language-agnostic. Cursor/Aider/Gemini CLI deben poder enchufarse después sin tocar el core.

## Decisiones ABIERTAS — tú decides y justificas brevemente

1. **Lenguaje**: usa el stack del monorepo. Si hay opción, prioriza binario único distribuible (Rust ≫ Go ≫ Node SEA ≫ Python con shiv).
2. **Mecanismo de "papelera inalcanzable"**: evalúa permisos unix + setuid vs. bind-mount RO vs. `chattr +i` vs. WORM. Elige el más simple que sea sólido en Linux + macOS. Windows opcional.
3. **IDs**: ULID, UUIDv7, o `timestamp+hash`. Que ordene cronológicamente.
4. **TTL y cuotas**: defaults razonables, configurables.
5. **Cifrado at-rest**: si el contenido puede traer secretos (`.env`, dumps), valora si entra en MVP o roadmap.
6. **Ergonomía CLI**: nombre binario, subcomandos, flags. Estilo del monorepo.

## Requisitos no funcionales

- **Fail-closed siempre**: snapshot falla → bloquea. Sin disco → bloquea. Permisos rotos → bloquea. Jamás "ejecutar sin guardar copia".
- **Tests**: ≥80% en snapshot + permisos. Tests de integración que demuestren que un proceso simulando "la IA" (user sin privilegios) NO puede leer la papelera, NO puede escribirla saltándose el binario, y NO puede invocar `empty`.
- **Seguridad del binario**: mínimo, auditable, sin `system()` ni shell-out con input no sanitizado. Si usas setuid, justifica y minimiza superficie.
- **Performance**: snapshot de `rm -rf node_modules` en segundos, no minutos. Reflinks/CoW cuando se pueda.
- **Logs estructurados**: JSON Lines, append-only.
- **Idioma del código**: identificadores en inglés; docs en castellano si el resto del monorepo está en castellano.

## Lo que NO debes hacer

- **No** intentes cubrir efectos externos no-revertibles (mails enviados, webhooks, deploys a prod). Eso se resuelve con una deny list residual pequeña, fuera del scope.
- **No** intentes cubrir exfiltración de datos. Eso es aislamiento de red.
- **No** añadas UI gráfica. CLI + logs es suficiente.
- **No** uses una IA secundaria como "judge" en la capa de seguridad. Determinismo obligatorio.
- **No** modifiques código de Claude Code/Cursor/etc. Solo hooks/adapters que esos sistemas ya soportan.
- **No** sobreescribas ficheros existentes con Write — usa Edit.

## Workflow esperado — 3 fases con check de validación entre cada una

### Fase 1 — Evaluar (informe, SIN código)

Antes de tocar nada:

1. Lee la estructura del monorepo: convenciones de paquetes, build, naming, tests, CI, publicación.
2. Identifica el paquete existente que más se parece (CLI con binario) — usaremos como plantilla.
3. Detecta infraestructura compartida (logger, config loader, test helpers).
4. Devuelve un **informe ≤300 palabras** con:
   - Stack y herramientas elegidos.
   - Paquete plantilla.
   - Decisiones tomadas sobre puntos abiertos (lenguaje, papelera, IDs, TTL, cifrado).
   - Lista de tareas previstas para fases 2 y 3.
   - Riesgos detectados.

**No escribas código aún.** Espera mi OK.

### Fase 2 — Plan (plan mode)

Cuando apruebe la fase 1, entra en plan mode:

- Ficheros a crear/modificar.
- Tests previstos por capa.
- Cómo se integra con el monorepo (workspace, `package.json`/`Cargo.toml`/`pyproject.toml`).
- Cómo se publica independiente.
- Orden de commits propuesto.

Espera mi OK al plan.

### Fase 3 — Implementar

- Rama por feature, jamás commits a `main`.
- Commits **atómicos**, conventional commits.
- Cada commit compila y pasa tests.
- Sin referencias a Claude/IA en mensajes de commit.
- PR final con descripción clara, demo de uso, y checklist de seguridad cubierto.

## Reglas de proceso

- Si una decisión tiene ≥2 opciones igualmente válidas, **pregúntame antes**. No inventes preferencias.
- Si necesitas tocar config global del SO (sudoers, systemd, polkit), **pide permiso primero**.
- ES modules y APIs modernas si tocas JS/TS. Nada deprecado.

## Entregable final

1. Paquete funcional en el monorepo, instalable de las dos formas.
2. Tests pasando.
3. README del paquete con: install standalone, install vía karajan, ejemplo de uso, **modelo de amenazas** (qué cubre / qué NO), troubleshooting.
4. Adapter para Claude Code (hook bash + ejemplo de `settings.json`).
5. **Roadmap** escrito de extensiones futuras: Docker volumes, S3, kubectl, cifrado at-rest, sincronización WORM externa.

## Empieza

Cuando entiendas el encargo, arranca por la **Fase 1**: leer el monorepo, generar el informe ≤300 palabras, esperar mi OK.
