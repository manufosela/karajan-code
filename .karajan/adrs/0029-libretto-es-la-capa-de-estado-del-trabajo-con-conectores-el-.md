# Libretto es la capa de estado del trabajo, con conectores; el HU Board es una vista

Status: proposed
Date: 2026-10-25

## Context

El HU Board mezcla dos cosas. Una es dónde viven las historias de usuario (hoy, el plan local o las issues de GitHub del ADR 0025). La otra es una ventana a lo que Karajan hace: sesiones de `kj run`, veredictos, el acta de gobierno, el pipeline, el RAG. No se publica, lee los ficheros de kj y cinco de sus siete pestañas son vistas de kj, así que no cumple la regla de la familia (cada pieza sirve sola y kj la consume por su contrato), y el ADR 0027 le dio un nombre de familia, Libretto, sin resolver eso.

Karajan, además, ya trabaja sin que nadie abra el board: el agente trabaja, los gates gobiernan y el rastro queda en git, en las PRs y en el acta. El mantenedor (25-oct-2026) quiere que cada usuario elija cómo ver lo que Karajan hace (el board, Linear, un GitHub Project), sabiendo al conectar qué no podrá ver o gestionar, porque el HU Board, hecho a medida, será siempre el más completo.

Ya hay medio camino: dos almacenes de historias intercambiables (local y GitHub Issues, con caché sin red) y `state_backend: external`, que deja al agente trabajar con Linear o Jira a través de su MCP sin que kj refleje nada.

## Options

A) Libretto es la capa de estado del trabajo (elegida para debatir). Un paquete de familia con dos contratos: el de historias (crear, listar, mover, reservar, con un conector por sistema, uno solo como fuente de verdad del proyecto) y el de eventos de lo que Karajan hace (sesiones, veredictos, decisiones de gobierno, en un solo sentido hacia las vistas). El HU Board web pasa a ser una vista más, la más completa.

B) El HU Board se queda como la interfaz de kj y sale de la familia. Cero coste, pero cada usuario sigue obligado a abrir el board para ver lo que Karajan hace, y conectar otro sistema sigue siendo cosa del agente, sin contrato.

C) Como si el código no existiera: Karajan solo emite eventos (como un exportador de OpenTelemetry) y no gestiona historias; cada equipo las lleva donde quiera y su agente las mueve. Es lo más simple, pero el Sentinel necesita leer la card antes de dejar tocar código (card-first), y sin un contrato de historias esa garantía depende de lo que cada agente decida hacer.

## Decision (propuesta)

A, en tres piezas:

1. **Una sola fuente de verdad por proyecto**, declarada en el repo: local, GitHub Issues, Linear, GitHub Projects o Planning Game. kj lee y escribe solo en ella. Nunca sincronización en los dos sentidos entre dos sistemas.
2. **Los eventos de lo que Karajan hace se publican en un solo sentido** a las vistas que el usuario active. La fuente es el acta encadenada, que ya es un registro de eventos.
3. **Cada conector declara sus capacidades**, y kj las enseña al conectar (`kj hu backend <sistema>`) y en `kj doctor`: qué podrá ver y gestionar y qué no, y dónde verlo (el HU Board) cuando falte. Ejemplo de la matriz que se declararía:

| Capacidad | HU Board | GitHub Issues | GitHub Projects | Linear | Planning Game |
|---|---|---|---|---|---|
| Historias: crear, mover, reservar | sí | sí | sí | sí | sí |
| Criterios de aceptación y tests de cada historia | sí | en el cuerpo | en el cuerpo | en la descripción | sí |
| Dependencias entre historias (grafo) | sí | parcial | parcial | sí | sí |
| Sesiones de `kj run` y sus iteraciones | sí | no | no | no | no |
| Veredictos de la review cruzada | sí | en la PR | en la PR | comentario | no |
| Acta de gobierno y excepciones | sí | no | no | no | no |
| Pipeline en directo, RAG, wiki | sí | no | no | no | no |

Los valores de la tabla son orientativos: cada conector los fija en su propia declaración, con tests, cuando se construya.

Orden propuesto: escribir los dos contratos; mover los dos almacenes actuales (local y GitHub Issues) detrás del de historias sin cambiar nada visible; el HU Board pasa a leer de Libretto; y solo después el primer conector nuevo (Linear).

## Consequences

Libretto se convierte en un miembro de familia real, publicable y útil sin kj, y el HU Board en su vista más completa; el ADR 0027 se resuelve dentro de este. Cada conector es mantenimiento para siempre y trae su propia autenticación e identidad (como ya pasó con las cuentas de gh). El Sentinel exige que cada conector conteste rápido y aguante sin red, como la caché del board de GitHub. Lo que un sistema no puede mostrar no se esconde: se dice al conectar y en `kj doctor`, con el enlace a la vista que sí lo muestra.
