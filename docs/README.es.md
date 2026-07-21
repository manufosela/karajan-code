<p align="center">
  <img src="karajan-orbit.svg" alt="Karajan Code" width="220">
</p>

<h1 align="center">Karajan Code</h1>

<p align="center">
  El entorno que gobierna el desarrollo con IA — tu agente orquesta, Karajan gobierna.
</p>

<p align="center">
  <a href="../README.md">Read in English</a> · <a href="https://karajancode.com">Documentación</a> · <a href="https://planning-game-xp.web.app/public/?project=Karajan%20Code">Roadmap público</a>
</p>

---

Tu agente de IA (Claude Code, Codex, Gemini CLI, Cursor…) escribe el código. **Karajan gobierna cómo ocurre**: instala un método que tu agente sigue en cada tarea y lo hace cumplir con gates de git que hacen el falso verde estructuralmente imposible.

- **RAG antes de suponer** — `kj rag query` responde qué hace tu código; ningún agente adivina.
- **Card primero** — todo trabajo se registra (`kj hu add|move|list`) antes de empezar; las decisiones de arquitectura viven como ADRs en git (`kj adr add|list`).
- **Los tests prueban el comportamiento** — el test que falla existe primero; la suite nunca se queda en rojo.
- **Revisión IA-cruzada en cada commit** — `kj review --staged` liga el veredicto de una IA *distinta* al sha256 del diff exacto. Cambia el código y hay que revisarlo de nuevo. Sin veredicto aprobado, **el commit no entra** (gate pre-commit).
- **Una tercera IA arbitra las disputas** — `kj solomon` decide cuando brain y reviewer discrepan. Los hallazgos de seguridad no los anula nadie — ni siquiera el arbitraje.
- **Rama primero** — la rama base solo se mueve por PRs atómicas.

Este repo corre bajo su propio entorno: cada commit de karajan-code lleva un veredicto de IA cruzada.

## Instalación

Dile a tu agente — en el directorio donde quieras trabajar:

```text
Quiero usar Karajan en este proyecto: lee https://karajancode.com/start.md
y haz lo que dice.
```

El prompt enrutador instala el stack completo si hace falta, detecta si el proyecto es nuevo o existente, activa el entorno, y **para a esperarte** cuando un paso necesita sudo o una cuenta (código de salida 3 de `kj` = pendiente de ti — una instalación parcial es una instalación fallida).

Equivalente manual:

```sh
curl -fsSL https://karajancode.com/install.sh | sh   # producto completo (npm-first; --standalone para solo-CLI)
kj doctor && kj install-tools                        # completa el stack
kj init && kj env install && kj harden && kj review --install-gate
git config core.hooksPath .karajan/hooks
```

Requiere git y al menos un CLI de agente de IA — con dos hay revisión cruzada; con tres, arbitraje. Todas las rutas de instalación (npm, binarios, brew, wrapper Python) en la [doc de instalación](https://karajancode.com/docs/es/v4/install/).

## El bucle diario

1. Describes lo que quieres. Tu agente crea la card (`kj hu add`), consulta el RAG, escribe el test que falla y después el código.
2. `kj review --staged` — una IA distinta revisa el diff exacto. Aprobado → el commit entra. Rechazado → se corrige, o se escala a `kj solomon`.
3. PR atómica a la rama base. `kj report` muestra el rastro; el HU Board (`kj board`) muestra el trabajo.
4. ¿Tu agente choca con un bug de kj? `kj report-issue` lo sube — sanitizado, deduplicado y solo con tu aprobación. El ecosistema se repara solo.

Método completo: [Trabaja con tu agente](https://karajancode.com/docs/es/v4/working-with-your-agent/) · [Los gates](https://karajancode.com/docs/es/v4/gates/) · [Referencia de comandos](https://karajancode.com/docs/es/v4/commands/).

## Modo headless

El pipeline multiagente clásico sigue vivo para CI y automatización: `kj run "<tarea>"` orquesta roles coder/reviewer/tester en subprocesos sin humano delante, con los mismos gates. `kj advanced` lista la superficie completa. [Doc del modo headless](https://karajancode.com/docs/es/v4/headless/).

## v3 (histórico)

Karajan v1–v3 fue un pipeline multiagente headless dirigido por completo mediante orquestación de subprocesos. Su historia íntegra — pipeline, 24 roles, servidor MCP, step mode, carriles paralelos — se conserva en el **[README de v3 (archivo histórico)](README.v3.es.md)** y en el [archivo de docs v3](https://karajancode.com/docs/es/getting-started/introduction/).

## Contribuir y licencia

Issues y PRs bienvenidas — los informes de fricción vía `kj report-issue` valen oro. Licencia [AGPL-3.0](../LICENSE).
