# El método se impone en puntos de control, no leyendo shell

Status: proposed
Date: 2026-10-03

## Context

La auditoría `docs/audit/2026-10-gates-and-escapes.md` cuenta 53 arreglos de gates desde el 1 de septiembre (en agosto, 47 arreglos en total) y 15 escapes `KJ_ALLOW_*`. Dos tercios de los arreglos son gates que deciden con información incompleta, y la parte que lee comandos de shell no tiene fondo: unos 25 rodeos en dos guards en un día. Cada escape es un gate que no supo distinguir, y el agente puede activarlo él mismo. Donde el método se impone en un punto de control que el agente no toca (hooks de git, CI, protección de rama, veredicto atado al diff), casi no falla.

## Decision (propuesta)

1. **Imponer en puntos de control externos.** Card, tests, review cruzada, tamaño y formato se exigen en pre-commit, pre-push y CI con checks obligatorios y protección de rama. Allí el agente no llega.
2. **Sentinel pequeño.** Dentro de la sesión quedan los recordatorios y unos pocos guards con señales estructurales (la ruta de Edit/Write, el estado de git), nunca la interpretación del texto de un comando. Los guards que leen shell (escrituras por Bash, descartes por texto) se sustituyen por el sandbox del anfitrión, que limita la escritura a nivel de sistema.
3. **Ningún escape activable por el agente.** Un gate que necesita escape es un gate a corregir. Las decisiones de proyecto que de verdad lo son (PR grande, bloqueo del Steward) tienen su cauce humano fuera de la sesión: una etiqueta en GitHub, un cambio de config por PR.
4. **Juez por modelo, acotado.** Un modelo distinto del agente decide los casos que lo determinista marca como "no sé", con salida cerrada y validada por esquema, en los puntos de control (al commitear, al cerrar el turno). Solo puede añadir fricción, nunca levantar un deny determinista, porque un modelo se puede manipular con el propio texto que juzga.

## Alternatives

- **Greenfield: todo en CI y nada dentro de la sesión.** Lo más robusto, pero el agente descubre las reglas al final y vuelve a pasar lo de "lo detectas cuando el gate lo veta". Los recordatorios y la reinyección tras compactar sí se quedan dentro.
- **Seguir ampliando el Sentinel.** Es el camino de septiembre: cada regla nueva trae falsos positivos, escapes y rodeos.
- **Mover los escapes al humano (conceder desde la terminal).** Descartada por el usuario: no puede estar concediendo escapes.

## Consequences

Se retiran los guards de shell y la mayoría de los escapes; el sandbox pasa a ser requisito para la garantía de "no escribe fuera". Los checks obligatorios de CI y la protección de rama se vuelven parte de `kj harden`. El juez por modelo cuesta tokens solo en los casos ambiguos.
