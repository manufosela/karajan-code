---
title: Pasar a Node 24
description: Por qué Karajan recomienda Node 24, qué cambia y cuándo, y el prompt que hace el cambio por ti.
---

Karajan funciona en Node 22 y en Node 24. El soporte de Node 22 termina en abril de 2027, así que Karajan recomienda Node 24 desde ya: `kj doctor` lo dice, y cualquier comando de `kj` te lo recuerda una vez al día mientras sigas en un Node anterior.

## Qué pasa y cuándo

- **Ahora (5.x)**: no se rompe nada. kj funciona en Node 22.12 o superior, y la CI prueba cada cambio en Node 22 y en Node 24.
- **Más adelante, en kj 6.0**: Node 24 pasa a ser el mínimo. La fecha se anunciará con antelación y será antes de que termine el soporte de Node 22.

## Que lo haga tu agente

Pega esto en tu agente (Claude Code, Codex, Cursor, VS Code):

```text
Move me to Node 24 and keep Karajan working: read karajancode.com/node-24.md and do everything it says.
```

El agente averigua cómo está instalado Node en tu máquina (nvm, fnm, Volta, Homebrew, el paquete del sistema, Windows o el Node que instala el propio Karajan), instala Node 24 con esa misma herramienta, pasa tus paquetes globales de npm, reinstala kj si se ha perdido y ejecuta `kj doctor`. Pregunta antes de cada instalación y se para cuando un paso te necesita (sudo, Administrador, un inicio de sesión). El Node antiguo se queda instalado; te dice cómo quitarlo si quieres.

## A mano, con nvm

```sh
nvm install 24 --reinstall-packages-from=current
nvm alias default 24
```

Abre una terminal nueva y después:

```sh
node --version   # v24.x
kj --version
kj doctor
```

Con nvm cada versión de Node tiene sus propios paquetes globales; `--reinstall-packages-from=current` los pasa, kj incluido. Con otra herramienta, reinstala kj con `npm install -g karajan-code` después del cambio.
