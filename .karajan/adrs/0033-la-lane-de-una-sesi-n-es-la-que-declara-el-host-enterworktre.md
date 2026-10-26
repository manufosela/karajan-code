# La lane de una sesión es la que declara el host (EnterWorktree), no la carpeta donde arrancó

Status: proposed
Date: 2026-10-26

## Context

MONO-0 toma como lane propia el toplevel donde está instalado el guard. Claude Code puede mover la sesión a un worktree (EnterWorktree) y lo comunica en el cwd del payload; el Sentinel no lo lee y deniega cada Edit con «vive en otro carril» (#2566). Modifica ADR 0002; no toca el «sin escape» de ADR 0015.

## Decision

1) La lane propia es el toplevel del cwd del host cuando es un worktree del mismo repo (mismo git-common-dir); si no, el lugar de instalación. 2) Una lane por sesión: la primera mutación fija session.lane y una mutación desde otra lane se deniega, sin escape. 3) card-first, rag-first y las rutas relativas usan la lane propia; el estado del harness sigue en el checkout principal. Alternativas descartadas: lane por ruta del fichero (rompe una sesión, un carril) y no cambiar nada (una sesión por lane).

## Consequences

EnterWorktree + kj hu start permiten el ciclo completo desde una sesión. Un cd de Bash también mueve el cwd; el punto 2 impide saltar de lane tras escribir. kj harden cambia el hook canónico y el sello (ADR 0009) se regenera a la vez. Estado: PROPUESTO, decide Manu.
