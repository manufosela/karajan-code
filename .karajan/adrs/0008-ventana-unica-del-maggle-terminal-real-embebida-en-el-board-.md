# Ventana unica del maggle: terminal real embebida en el board via pty, no un chat propio sobre SDK

Status: accepted
Date: 2026-09-03

## Context

MGL-D KJC-TSK-0811 pide una sola ventana: hablar con el agente y ver tablero y actividad sin terminal aparte. Spike con tres enfoques. A pty embebido: kj go lanza el agente real dentro de un pseudo-terminal servido al board por WebSocket local y renderizado con xterm.js. El harness queda intacto: los hooks sincronos del Sentinel siguen garantizados porque el proceso sigue siendo Claude Code interactivo. Dependencia nativa node-pty con precedente ya asumido en better-sqlite3. Riesgo de mantenimiento bajo, no depende de APIs privadas del agente ni de su TUI. B chat propio sobre SDK o modo headless: estetica de chat superior, pero cambia el harness. Los hooks del Sentinel estan garantizados en el host interactivo y un SDK es otra superficie que auditar. Codex no tiene equivalente simetrico, obligando a doble implementacion o a solo-Claude. Permisos de herramientas, resume y streaming exigen mucho codigo propio. Mantenimiento alto y acoplado a APIs que cambian cada mes. C app de escritorio Electron o Tauri envolviendo board mas terminal: la unica que da icono y doble clic, pero firma de binarios, updates y tres sistemas operativos son una superficie enorme, y dentro sigue haciendo falta resolver A igualmente.

## Decision

Enfoque A: la ventana unica es el board con la terminal REAL del agente embebida via pty y xterm.js, activada por kj go como panel junto al tablero. WebSocket solo en 127.0.0.1 con token de sesion. La fase 1, kj go con terminal mas board, sigue funcionando igual: esto es un anadido opcional, jamas un reemplazo. B queda descartado mientras el Sentinel dependa de los hooks del host interactivo: el harness garantizado es la ventaja de Karajan y no se cambia por estetica. C queda como posible envoltura futura sobre A si algun dia se quiere app instalable.

## Consequences

El maggle ve una terminal renderizada dentro del board: es el agente real con exactamente las mismas garantias que en fase 1. Nuevas dependencias en el board: node-pty nativa y xterm.js. Exponer una shell interactiva por WebSocket se mitiga con bind local y token y se audita con kj audit --security antes de implementar. NADA se implementa hasta que el usuario acepte este ADR.
