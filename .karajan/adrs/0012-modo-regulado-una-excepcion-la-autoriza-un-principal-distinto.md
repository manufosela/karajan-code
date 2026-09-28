# Modo regulado: una excepción la autoriza un principal distinto del agente y la verifica un tercero

Status: accepted
Date: 2026-09-28

## Context

Pregunta planteada el 28-sep-2026: si el propio agente decide abrir una excepción, aunque quede registrada, la política vuelve a ser una sugerencia con log. En entornos regulados hacen falta dos cosas más: que la excepción la autorice un principal distinto del agente, y que el registro lo pueda verificar un tercero sin confiar en quien lo emitió.

Estado comprobado en el código ese día:

- Lo que el agente no puede abrirse a sí mismo: la seguridad no es exceptuable ni arbitrable (`kj policy grant` rechaza `defaults.*` y la clase security), y el sello del supervisor es un acto humano que el Sentinel bloquea a cualquier sesión de agente.
- Lo que sí es "sugerencia con log": los 35 escapes `KJ_ALLOW_*` del Sentinel los puede poner el propio agente; quedan registrados, pero los decide él. Nada impide al agente ejecutar `kj policy grant`, y la identidad registrada es la de git, declarada y no autenticada (lo dice `packages/governance/src/exceptions.js`), la misma con la que commitea el agente.
- La verificación: el registro de decisiones está encadenado por hash, pero sin firma ni ancla externa, así que quien puede escribir puede regenerar la cadena entera. El de excepciones (`policy-exceptions.jsonl`) ni siquiera está encadenado.

## Decision

Un modo regulado declarado por proyecto (`governance.mode: regulated`). Fuera de él nada cambia. Dentro de él:

1. **Principal distinto del agente.** Una excepción solo tiene efecto si la autoriza una identidad que el agente no puede asumir: una firma con una clave del humano que el agente no posee (firma SSH verificada contra un `allowed_signers` versionado; preferible clave en hardware o passkey), o su aprobación en una PR revisada por otra cuenta, con CODEOWNERS y protección de rama sobre el fichero de excepciones. El Sentinel bloquea al agente `kj policy grant` y la escritura de ese fichero, y los `KJ_ALLOW_*` dejan de levantar nada por sí solos: pasan a ser solicitudes pendientes que un humano aprueba.
2. **Verificable por un tercero.** Cada entrada (excepción y decisión) va firmada y encadenada. La cabeza de la cadena se ancla fuera del alcance de quien la emite: commit firmado y, opcionalmente, sello de tiempo RFC 3161 o registro de transparencia tipo Sigstore/Rekor. `kj policy verify` comprueba firmas, cadena y ancla usando solo claves públicas, sin confiar en kj ni en quien emitió el registro.

## Consequences

La identidad pasa de declarada a autenticada. En modo regulado el agente pierde toda salida propia: cualquier excepción espera a un humano, que es justo el precio buscado. El humano necesita una clave de firma declarada en `allowed_signers`. El registro deja de ser un log y pasa a ser evidencia que una auditoría externa puede comprobar por su cuenta. Los proyectos no regulados no notan nada. Se reutiliza la cadena hash que ya existe en `decisions.js`, y el registro de excepciones se une a ella.
