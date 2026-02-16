# KJ Default Workflow (Codex)

## Objetivo
Usar Karajan Code (KJ) como vía principal para implementar tareas y resolver bugs.

## Regla por defecto
Ante peticiones de implementación/fix/refactor (incluyendo "haz la tarea más prioritaria"), no empezar con edición manual:
1. Si falta contexto de tarea, obtenerla del Planning Game MCP.
2. Ejecutar KJ por MCP (`karajan-mcp`) con `kj_run`.

## Defaults de ejecución
Para `kj_run`, usar por defecto:
- `mode: "standard"` (enfocado en crítico/importante)
- `methodology: "tdd"` (obligatorio por defecto)
- `coder: "codex"`
- `reviewer: "claude"`
- `reviewerFallback: "codex"`
- `maxIterations: 5`
- `maxIterationMinutes: 5`

## Excepciones
- Si el usuario pide más estricto: `mode: "paranoid"`.
- Si el usuario pide explícitamente no TDD: `methodology: "standard"`.
- Si falla KJ: ejecutar `kj_doctor`/`kj_config`, corregir y reintentar.
- Edición manual directa solo si el usuario lo pide o KJ no puede completar.

## Comportamiento esperado con prompt natural
Prompt: "realiza la tarea siguiente más prioritaria del proyecto".
Acción:
1. Consultar PG MCP para extraer la tarea prioritaria.
2. Ejecutar `kj_run` con esa tarea y los defaults anteriores.
