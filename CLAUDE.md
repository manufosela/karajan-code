# KJ Default Workflow (Claude Code)

## Objetivo
Usar Karajan Code (KJ) como orquestador por defecto para implementar tareas y corregir bugs.

## Regla por defecto
Si el usuario pide implementar/fix/refactor (o "hacer la siguiente tarea prioritaria"), no edites manualmente primero:
1. Obtener tarea (si aplica) desde Planning Game MCP.
2. Ejecutar KJ por MCP con `karajan-mcp` usando `kj_run`.

## Flujo operativo por defecto
1. Si la petición no trae tarea concreta:
   - Consultar Planning Game MCP y recuperar la tarea más prioritaria.
2. Ejecutar `kj_run` con estos defaults:
   - `mode: "standard"`
   - `methodology: "tdd"`
   - `coder: "codex"`
   - `reviewer: "claude"`
   - `reviewerFallback: "codex"`
   - `maxIterations: 5`
   - `maxIterationMinutes: 5`
3. Mostrar resultado y resumen de cambios.

## Cuándo cambiar el comportamiento
- Si el usuario pide máxima rigurosidad: usar `mode: "paranoid"`.
- Si el usuario pide explícitamente no TDD: usar `methodology: "standard"`.
- Si `kj_run` falla, diagnosticar (`kj_doctor`, `kj_config`) y reintentar.
- Solo editar manualmente si el usuario lo pide o KJ no puede completar.

## Ejemplo natural
Input usuario: "realiza la tarea siguiente más prioritaria del proyecto".
Acción esperada:
1. Leer tarea prioritaria en PG MCP.
2. Lanzar `kj_run` con esa tarea y defaults anteriores.
