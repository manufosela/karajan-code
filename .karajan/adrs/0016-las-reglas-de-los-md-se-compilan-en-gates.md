# Las reglas de los MD se compilan en gates

Status: accepted
Date: 2026-10-04
Accepted: 2026-10-04 (dev_001)

## Context

Las reglas que gobiernan una sesión viven en prosa: CLAUDE.md, AGENTS.md, las guidelines del proyecto, las memorias de feedback. El agente las lee y, aun así, las incumple en el momento de actuar. El caso que lo abrió: una sesión creó sprints de una semana cuando su MD dice que son de un día. La herramienta permitía sprints largos con un parámetro, el agente lo puso y nada lo paró, porque ninguna regla escrita tenía un gate detrás. Los gates actuales cubren un puñado de reglas elegidas a mano (card-first, rag-first, identidad, descartes). Las demás dependen de que el agente se acuerde, y la experiencia dice que no basta: los recordatorios del ADR 0014 ayudan, pero no impiden.

## Decision

Cada regla escrita en los MD tiene un gate, y que una regla no lo tenga se ve.

1. **Inventario.** kj extrae las reglas de los MD que gobiernan la sesión y las guarda como entradas con identificador, texto literal y fichero de origen.
2. **Compilación, una vez por versión del MD y no en cada acción.** Un modelo traduce cada regla a uno de dos tipos. Determinista: una condición sobre la acción (qué herramienta, qué argumentos, qué fichero o comando), evaluada sin modelo. De criterio: la regla no cabe en una condición y se marca con las acciones a las que aplica. Cada regla compilada lleva ejemplos que debe denegar y ejemplos que debe permitir, que funcionan como sus tests. El usuario aprueba el resultado: la compilación es una propuesta, no se aplica sola.
3. **Evaluación en cada acción.** El PreToolUse del Sentinel evalúa toda tool call, las de servidores MCP incluidas. Las reglas deterministas se comprueban siempre. Las de criterio las juzga un modelo distinto del agente (el juez del ADR 0015), solo las que aplican a esa acción y solo en acciones con efecto. El juez solo puede denegar, nunca levantar un deny determinista. Todo deny cita el identificador de la regla y el MD de donde sale.
4. **Cobertura y desfase.** `kj rules coverage` lista cada regla con el gate que la cubre. Si un MD cambia, las reglas compiladas quedan desfasadas y el Sentinel lo dice hasta que se recompilan y el usuario las aprueba.

Como en el ADR 0015, ningún gate generado tiene escape: un falso positivo se corrige en la regla o en su compilación.

## Alternatives

- **Greenfield: reglas escritas desde el principio como código (policy declarativa) y los MD generados a partir de ellas.** Lo más fiable, porque la regla y el gate son lo mismo. Pero obliga al usuario a escribir YAML y no cubre las reglas de criterio. Se toma la mitad buena: lo determinista acaba en la policy, y la fuente sigue siendo la prosa del usuario.
- **Juez por modelo para todo, sin compilación.** Cubre cualquier regla sin trabajo previo, pero cada acción cuesta tokens y latencia, y un modelo se puede manipular con el texto que juzga. Queda solo para las reglas de criterio.
- **Gates escritos a mano, regla a regla.** Es lo de hoy: no escala, y las reglas sin gate son invisibles.
- **Más recordatorios (ADR 0014).** Ayudan a recordar, no impiden. Se mantienen como complemento.

## Consequences

Las reglas dejan de depender de la memoria del agente: las deterministas se cumplen o la acción no ocurre, y las de criterio pasan por un segundo modelo. El coste está en compilar (una vez por versión del MD) y en el juez (solo acciones con efecto que tocan reglas de criterio). Las reglas sobre cómo piensa o responde el agente, más que sobre lo que ejecuta, no se vigilan desde una tool call y quedan fuera, dicho en la cobertura. Las aprobaciones del usuario son el precio de que la traducción de su prosa a gates no la decida el agente.
