---
title: La release coordinada
description: Cómo un equipo que trabaja en un mismo repositorio con kj acuerda una versión antes de publicarla, de kj release propose a kj release verify.
---

Cuando varias personas trabajan en un mismo repositorio, cada una con sus agentes, una release que decide una sola sesión pilla por sorpresa a los demás: su trabajo mergeado sale sin que lo sepan, y nadie comprueba que lo que tienen en curso sigue encajando. El ADR 0057 convierte la release en un acuerdo corto y registrado. Se pregunta a todo el que tiene una parte en ella, cualquiera puede retenerla, y una persona firma antes de publicar.

## La idea en un párrafo

Alguien propone una versión. kj abre una issue de GitHub con lo que sale, por autor, y lo que se queda fuera, por dueño de cada pull request abierta, y los menciona a todos. Cada uno contesta desde su propia sesión, y su agente comprueba antes el commit candidato. Pasadas 4 horas, el silencio cuenta como sin objeción; un «retener» bloquea siempre. Cuando la release está lista, una persona del padrón de firmantes la aprueba con su móvil, y solo entonces se crea la etiqueta. La CI no publica nada que no esté aprobado.

## A quién se pregunta

- **A los autores de lo que sale**: todo el que tiene commits desde la última etiqueta. Los commits de merge no cuentan, porque nombran a quien mergeó, no a quien escribió.
- **A los dueños del trabajo en curso**: el autor de cada pull request abierta, para que compruebe que el candidato no rompe lo que está haciendo.

Los bots y los autores sin cuenta de GitHub aparecen en la issue, pero no se les pregunta: nadie puede contestar por ellos.

## Paso a paso

### 1. Proponer

```sh
kj release propose 5.22.0
```

Abre la issue `Release 5.22.0` con la etiqueta `release`: el commit candidato (el `HEAD` actual), la etiqueta base, el plazo (4 horas desde ahora, en UTC), lo que sale y lo que se queda fuera. La última línea de la issue es un bloque que leen los comandos siguientes; no lo edites a mano.

### 2. Contestar

Cada participante, desde su propia sesión:

```sh
kj release ack 4242 ok
kj release ack 4242 hold --why "la migración de #4230 tiene que ir antes"
kj release ack 4242 include --include 4230
```

Cada respuesta pasa antes la comprobación de compatibilidad: la suite completa sobre el commit candidato, y la suite sobre los commits propios del participante rebasados encima. Las dos corren en worktrees temporales que se borran siempre, así que tu árbol y tu rama no se tocan. El resultado viaja con la respuesta.

- Un `ok` con la comprobación en rojo se publica, pero cuenta como retener: un ok que no pasa su propia comprobación no es un ok.
- Una respuesta solo cuenta si la da un participante, y solo para el candidato que nombra la issue.
- Vale tu última respuesta: puedes retener y luego decir ok.

### 3. Ver el estado

```sh
kj release status 4242
```

Dice quién ha confirmado, quién retiene y por qué, quién no ha contestado y hasta cuándo. Sale con 1 mientras la release no está lista. Está lista cuando nadie la retiene y todos han contestado, o han pasado las 4 horas.

### 4. Aprobar

```sh
kj release approve 4242
```

Es un acto humano: kj lo rechaza en la sesión de un agente, y pide tu firma en el móvil, con una passkey o una clave del padrón de firmantes. Antes de firmar comprueba que la release está lista; después de firmar vuelve a leer la issue y se para si alguien la ha retenido entretanto. Luego publica la aprobación firmada en la issue, etiqueta el candidato como `v5.22.0` y sube la etiqueta.

### 5. Publicar

La etiqueta lanza el workflow de release. Antes de publicar, ejecuta:

```sh
kj release verify v5.22.0
```

Solo pasa si la etiqueta está en `main`, hay exactamente una issue de release para esa versión, la etiqueta apunta a su candidato, la release sigue lista (un «retener» publicado después de la aprobación también la para) y la aprobación la firma alguien del padrón. Cualquier otra cosa para la publicación y dice por qué.

## Un repositorio de una sola persona

No estorba: eres el único participante, contestas y apruebas.

## Lo que no sustituye

La aprobación del entorno `npm-publish` en la ejecución, si tu repositorio la tiene, se queda como capa adicional. La release coordinada decide si una versión debe salir; el entorno decide si esta ejecución puede usar las credenciales de publicación.
