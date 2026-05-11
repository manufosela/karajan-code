# Task file templates

Plantillas y guía para los `.md` que pasas a los comandos de Karajan via `--task-file`. Sin estas, escribir un task file requiere ensayo y error caro (cada `kj plan generate` cuesta $0.30–0.80 en LLM y 2–5 minutos).

## ¿Por qué importan?

Karajan delega cada rol (planner, researcher, architect, discover, refactorer, coder, reviewer) a un LLM con un *system prompt* específico. Lo que tú escribes en el `--task-file` se concatena con ese system prompt como contexto del usuario. **El nivel de detalle que metas cambia radicalmente el output:**

- **Task demasiado breve** ("haz una API"): el LLM inventa contexto y genera trabajo genérico que tienes que reescribir.
- **Task demasiado estructurado** (ya parece un plan completo con secciones, IDs, tablas): el LLM piensa que tu trabajo es "reformatear", no "diseñar", y produce meta-documentación en vez de HUs reales.
- **Task con la dosis correcta**: descripción narrativa de la feature + restricciones técnicas + reglas no negociables + reglas de output. El LLM tiene espacio para diseñar pero contexto para no inventar.

Ese sweet spot es lo que estas plantillas codifican.

## Cómo usar una plantilla

1. Identifica qué comando vas a ejecutar (`kj plan generate`, `kj run`, `kj researcher`, etc.).
2. Copia la plantilla correspondiente desde `docs/task-templates/<comando>.md` a tu proyecto (ej. `tasks/01-mi-feature.task.md`).
3. Rellena los placeholders (líneas que empiezan con `<!-- ... -->` o `[REPLACE: ...]`).
4. Borra las secciones marcadas como "opcional" si no aplican.
5. Lanza el comando con `--task-file <ruta>`.

## Plantillas disponibles

| Comando | Plantilla | Cuándo |
|---|---|---|
| `kj plan generate` | [`plan-generate.md`](plan-generate.md) | Descomponer una feature en HUs ejecutables |
| `kj run` | [`run.md`](run.md) | Lanzar una sola HU concreta (sin plan) |
| `kj researcher` | [`researcher.md`](researcher.md) | Explorar el codebase antes de codear |
| `kj architect` | [`architect.md`](architect.md) | Diseñar la solución antes de codear |
| `kj discover` | [`discover.md`](discover.md) | Detectar gaps/ambigüedades en una tarea |
| `kj refactorer` | [`refactorer.md`](refactorer.md) | Mejorar código existente sin cambiar comportamiento |

## Antiejemplos comunes (no hagas esto)

### ❌ Antiejemplo 1 — Task demasiado breve

```markdown
Build a REST API for managing users.
```

Problema: el LLM tiene que inventar todo (stack, base de datos, auth, validación, tests). Output: HUs genéricas que no encajan en tu proyecto.

### ❌ Antiejemplo 2 — Task ya pre-procesado en formato de plan

```markdown
## ÉPICA: AUTH

| ID | Caso de uso | Actor | Precondiciones | Postcondiciones |
|---|---|---|---|---|
| AUTH-001 | Registrar usuario | nuevo líder | email no registrado | cuenta creada |
| AUTH-002 | Login | líder | cuenta activa | sesión iniciada |
| ... 12 casos más ...

## ÉPICA: PEOPLE
...
```

Problema: el LLM lo lee como "plan ya hecho, solo formatealo". Output: meta-documentación tipo "Crear scaffold .md, documentar épica AUTH, ...". El plan original era mejor.

Reportado en dogfooding como [KJC-BUG-0041](https://github.com/manufosela/karajan-code/issues) — el primer intento de Plan 1 del proyecto Equipazgo falló con este antipattern.

### ✅ Patrón ganador

```markdown
# MVP Foundations — auth + organizaciones

Necesito que descompongas en HUs ejecutables el primer slice del SaaS X.

## Qué construimos
[3-5 párrafos narrativos describiendo la feature: actores, flujo principal, casos de uso clave]

## Stack técnico ya decidido
[Bullet list compacto: lenguaje, frameworks, decisiones de arquitectura no negociables]

## Funcionalidades a descomponer
[Lista numerada de 20-30 items en lenguaje natural: "Líder se registra con OAuth", "Owner invita co-líder por email", etc. NO formatear como tabla con ID + precondiciones.]

## Reglas no negociables
[Aislamiento por tenant, audit log, cifrado, etc.]

## Spikes técnicos
[Setup infra, configurar Stripe, etc. que el planner debe incluir como HUs separadas.]

## Lo que necesito que generes
Una lista de HUs **atómicas y ejecutables individualmente con `kj run`**. Para cada HU:
- ID con prefijo de épica
- Historia "como X, quiero Y, para Z"
- 3-8 criterios de aceptación verificables
- Dependencias (las que existan REALMENTE; si no, vacío)
- Estimación XS/S/M/L/XL
```

## Reglas universales (aplican a CUALQUIER comando)

1. **Sin saltos lógicos**: si una decisión depende de información externa al task, explicita la fuente o la asunción. No dejes al LLM adivinar.
2. **Stack decidido > stack abierto**: si ya sabes que va a ser Astro + Lit + Firebase, dilo. Si lo dejas abierto, el LLM elegirá por ti y probablemente no será lo que querías.
3. **Sin tablas de plan pre-hecho**: cuando aparezcan tablas con ID + actor + precondiciones, el LLM tratará el trabajo como "rellenar el formato". Si quieres que diseñe, usa prosa.
4. **Reglas no negociables al final**: el LLM las verá justo antes de generar.
5. **Output esperado al final**: cierra el task indicando exactamente la forma del resultado (HUs, ADRs, lista de cambios, etc.).

## Próximos pasos

- Si quieres añadir una plantilla nueva, copia [`plan-generate.md`](plan-generate.md) como base y adapta las secciones.
- Si encuentras un antipattern más, añádelo a la sección "Antiejemplos comunes" arriba.
