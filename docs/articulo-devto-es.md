# ¿Por qué construí un orquestador local de agentes?

*Publicado en DEV.to — etiquetas: javascript, ai, mcp, opensource*

---

Llevo usando la IA para desarrollar desde hace tres años. Y he pasado por todas las fases, seguramente las mismas que vosotros.

Empecé usándola como autocompletado glorificado. Luego aceptando funciones completas. Luego clases enteras. Luego mediante prompts, pidiéndole que desarrollara cosas. Con toda la frustración que eso conlleva: no hace caso, cambia cosas que no le has pedido, se inventa funcionalidades, alucina con APIs que no existen... nada que no hayáis experimentado, seguro ;)

Pero poco a poco, junto con la mejora real de los modelos, fui viendo que cada vez estaba más cerca de poder construir aplicaciones completas sin escribir una sola línea de código. Solo revisando, corrigiendo, dirigiendo. El sueño era ese: automatizarlo de forma autónoma y con garantías.

El problema es que con un CLI o con un IDE siempre necesitas interactuar. Siempre. Alguien tiene que estar al volante. Cuando intenté resolver eso con las APIs para tener más control programático, me encontré con el otro problema: los costes. Una noche de agentes corriendo en bucle puede salirte cara. Muy cara. Sin aviso.

Con los CLIs, en cambio, Claude te dice en algún momento: "no puedes usarme más hasta mañana a las 7:00am". Por un lado te enfadas porque te deja a medias. Por otro piensas, bueno, corto por hoy. Y lo mejor de todo: no hay sorpresas en la tarjeta de crédito. El límite es el límite, y tú lo controlas.

Ahí estaba la clave. No llamar APIs. Orquestar CLIs. Coste predecible, autonomía real, sin necesitar estar pendiente.

Así nació Karajan Code.

## El problema que quería resolver, el que nadie más resolvía igual

Un pipeline orquestado que corriera de forma autónoma, con garantías de calidad, sin costes variables, sin que yo tuviera que estar delante. Eso era lo que quería. Analizar requisitos, escribir primero los tests, implementar, pasar SonarQube, revisar el código, iterar. Todo sin supervisión manual.

Claude Code es genial para trabajar de forma interactiva. Lo uso. Pero es una conversación, no un proceso. Cada ejecución depende del contexto de esa sesión. Lo que yo quería era más parecido a un pipeline de CI/CD: definirlo una vez, confiar en él, y que corra igual cada vez.

## Por qué "Karajan"

Herbert von Karajan fue el director de la Filarmónica de Berlín durante 35 años. Su filosofía era que una gran orquesta no es un director que controla a muchos músicos; son muchos músicos excelentes que saben exactamente cuándo tocar y cuándo escuchar, coordinados por alguien que entiende el conjunto.

Eso era lo que quería para los agentes de IA. No un modelo haciendo todo. Múltiples agentes especializados, cada uno excelente en su rol, coordinados por un orquestador que entiende el pipeline.

Por cierto, existe otro proyecto llamado karajan, creado por Wooga (una empresa de videojuegos móviles) como orquestador de agregaciones de datos sobre Apache Airflow. Misma inspiración musical, propósito completamente diferente. Buen nombre el de Karajan para esto de orquestar, al parecer.

## La arquitectura: roles como archivos markdown

La idea central de Karajan es que el comportamiento de los agentes sea declarativo y basado en archivos, no hardcodeado. Vi este patrón usado en diferentes contextos y herramientas, y quise aplicarlo aquí desde el principio.

Cada rol del pipeline está definido por un archivo markdown, un documento plano que describe qué debe hacer el agente, qué debe comprobar, y cómo es un buen output:

```
.karajan/roles/         # Tus overrides específicos del proyecto
~/.karajan/roles/       # Tus overrides globales
templates/roles/        # Defaults del sistema (incluidos con el paquete)
```

Actualmente hay 15 roles en el pipeline, cada uno gestionando una preocupación específica:

```
hu-reviewer? → triage → discover? → architect? → planner? → coder → sonar? → impeccable? → reviewer → tester? → security? → solomon → audit → commiter?
```

Puedes sobreescribir cualquier rol incorporado o crear nuevos. Sin código. Los agentes leen los archivos de rol y adaptan su comportamiento. Puedes codificar las convenciones de tu equipo, las reglas de tu dominio, tus estándares de calidad, y cada ejecución de Karajan los aplicará automáticamente.

La arquitectura hexagonal del proyecto fue influenciada por el trabajo de [Jorge del Casar](https://twitter.com/jorgecasar), tras ver un orquestador que tenía con una separación limpia entre capas.

## TDD y el pipeline completo

El pipeline impone los tests primero. El coder no solo escribe código: su prompt incluye escribir los tests antes que la implementación. TDD integrado en el rol, no como capa externa.

Luego el flujo continúa así:

1. **Coder** escribe tests y código (TDD dentro del propio rol)
2. **Sonar** analiza la calidad estática
3. **Reviewer** revisa el código; si hay conflicto con el coder, interviene Solomon
4. **Tester** verifica cobertura, calidad de los tests, que cubran los casos de uso y los acceptance criteria
5. **Security** audita según OWASP
6. **Audit** certifica el resultado final — si encuentra problemas críticos, envía al coder a corregir

Karajan auto-detecta tu framework de tests (vitest, jest, mocha, playwright). Sin configuración adicional para eso.

La razón de este orden es sencilla: los tests escritos después de la implementación son tests escritos para pasar el código que ya existe. Los tests escritos antes describen lo que el código debería hacer. Son cosas fundamentalmente distintas.

## Solomon: el árbitro

Solomon no es simplemente un supervisor que evalúa rechazos. Es el árbitro del pipeline cuando hay conflicto entre roles.

Cada rol tiene sus reglas y su cometido, y a veces eso genera un choque sin salida. Un ejemplo real: el coder hardcodea algo porque sabe que en una tarea posterior lo va a refactorizar (deuda técnica consciente y controlada). El reviewer, siguiendo sus reglas, no puede aprobar ese hardcodeo. Ninguno cede porque cada uno está haciendo bien su trabajo. Sin árbitro, el bucle no termina.

Solomon escucha las dos versiones, evalúa el contexto, y decide quién cede y en qué. No siempre es el reviewer quién tiene razón, ni siempre el coder. Depende del caso.

Y no es solo para conflictos coder-reviewer. Cualquier rol que encuentre un dilema que sus reglas no puedan resolver tiene acceso a Solomon. Solo cuando Solomon mismo encuentra un problema donde cualquier solución puede generar otro, usa el comodín: la interacción humana. Ese es el único momento en que Karajan te interrumpe para pedirte que decidas tú.

Es la diferencia entre un pipeline de IA que corre y uno que realmente converge.

## Routing multi-proveedor

Karajan soporta 5 agentes de IA: Claude, Codex, Gemini, Aider y OpenCode. Cada uno con su CLI. Configuras qué agente gestiona qué rol:

```yaml
# kj.config.yml
coder: claude
reviewer: codex
solomon: gemini
```

Por defecto, si tienes disponibles Claude, Codex y Gemini, los usa así: Claude para coder, Codex para reviewer, Gemini para Solomon. Si no tienes todos, Claude o Codex lo cubren todo. Tú decides según lo que tengas instalado y activado.

Y si quieres otro agente, tiene implementado un sistema de plugins para añadir fácilmente cualquier otro.

## Sin costes inesperados. Nunca.

Esta es la decisión técnica más importante del proyecto y la que más diferencia a Karajan de cualquier otro orquestador.

La mayoría de herramientas multi-agente llaman directamente a las APIs de IA. Cada invocación de agente cuesta tokens. Un pipeline complejo corriendo de noche, planificador, coder, reviewer, tester, bucle de SonarQube, puede generar una factura que no esperabas.

Karajan no llama APIs. Conduce los CLIs de IA: Claude Code CLI, Codex CLI, Gemini CLI, las mismas herramientas que usas interactivamente desde el terminal. Esos CLIs operan dentro de los límites de uso de tu suscripción. Cuando uno llega al tope, para. Te dice cuándo puede continuar. Y Karajan espera, guarda el estado del pipeline, y reanuda desde el último paso completado cuando el límite se resetea.

Sin trabajo perdido. Sin reiniciar desde cero. Sin sorpresas en la factura. El coste de Karajan es exactamente el coste de tus suscripciones. Nada más.

## MCP y ahorro de tokens con RTK

Karajan está construido sobre el Model Context Protocol. Expone 20 herramientas MCP, lo que significa que puedes usarlo desde dentro de Claude Code, Codex, o cualquier host compatible con MCP:

```bash
# Desde dentro de Claude Code:
kj_run({ task: "Fix the SQL injection in search endpoint" })
```

El agente de IA envía tareas a Karajan, recibe notificaciones de progreso en tiempo real y obtiene resultados estructurados. Sin copiar y pegar. Sin cambiar de contexto.

Además, Karajan se integra con [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) para reducir el consumo de tokens un 60-90% en cada comando Bash que ejecutan los agentes. Si RTK está instalado, Karajan lo detecta automáticamente e instruye a los agentes para usarlo. En pipelines largos, el ahorro es considerable.

Karajan también funciona standalone desde el terminal:

```bash
kj run "Create a utility function that validates Spanish DNI numbers, with tests"
```

## La configuración inicial

Un principio que perseguí desde el principio: si algo se puede detectar automáticamente, que se detecte. Pero voy a ser honesto: hay que ejecutar `kj init` para arrancar. Es una configuración mínima, y si tienes todo instalado y claro lo resuelves en un minuto. Si no tienes los CLIs instalados o configurados, te toca hacerlo.

Lo que sí se auto-detecta sin configuración adicional:

- Qué framework de tests usas, para habilitar TDD
- Si SonarQube está corriendo, arranca Docker si es necesario
- Complejidad de la tarea, simplifica el pipeline para tareas triviales
- Caídas del proveedor (errores 500), reintenta con backoff en vez de fallar

## Por qué vanilla JavaScript

Cada vez que lo menciono, alguien pregunta si planeo migrar a TypeScript.

No.

TypeScript es el invento de los programadores de Java que no entienden JavaScript y quieren convertirlo en otra cosa. Nació así. Está diseñado para quienes necesitan tipos fuertes porque vienen de lenguajes donde eso es obligatorio, y no saben trabajar de otra manera.

Yo llevo toda mi vida con JavaScript. Sé lo que hago. Uso JSDoc y archivos `.d.ts` y el IDE me avisa perfectamente si meto la pata. Tengo el control completo. Mi código se entiende igual en desarrollo que en producción si no lo minimizan, porque es el mismo lenguaje. Y si me sale de las narices usar `==` en algún momento concreto y sé exactamente por qué, lo hago. TypeScript me lo impediría.

Nadie me ha demostrado que usar TypeScript (aprendiendo interfaces, nomenclaturas y la sintaxis de `<TIPO>`) sea más eficiente o seguro que usar JS bien escrito. Para quien sabe JS, claro. Para quien viene de Java o C#, entiendo que TypeScript le resulte más cómodo. Respeto. Pero no es mi caso, y no voy a cambiar porque esté de moda.

Karajan tiene 1.847 tests en 149 archivos. CI verde en Node 20 y 22. Eso es la seguridad de tipos.

Sé que es una opinión impopular. A quien no le guste, que aprenda JS o que no mire :P

## Karajan desarrollado por Karajan

52 releases en 23 días. Mucha gente ve ese número y piensa que es caótico. No lo es, y hay una razón concreta: conforme el proyecto cogió tracción y tuve los primeros roles funcionando, empecé a desarrollar Karajan con Karajan mismo. El orquestador construyéndose a sí mismo.

Tuve que corregir cosas a mano, claro. Pero esa iteración acelerada, con el propio sistema como herramienta de desarrollo, fue lo que permitió descubrir mejoras y nuevos roles de forma orgánica. Cada release añade algo específico, documentado en el changelog. La velocidad es posible porque el suelo es sólido: vanilla JS con buena cobertura de tests te deja moverte rápido sin miedo.

## Estado actual

Karajan funciona. Lo uso. Tiene cosas por mejorar, como cualquier proyecto en desarrollo activo, y puede colgarse en alguna tarea especialmente compleja. Pero no es inestable: es un software en evolución constante que hace lo que dice que hace.

A la fecha de publicación de este artículo, Karajan va por la **versión 1.32.1**.

```bash
npm install -g karajan-code
kj init
kj run "Tu tarea aquí"
```

52 versiones publicadas, 1.847 tests, CI verde en Node 20 y 22.

**Qué hay en la última versión:**

- 15 roles de pipeline (incluyendo HU Reviewer para certificación de historias de usuario)
- 5 agentes de IA soportados
- 20 herramientas MCP
- Integración automática con RTK para ahorro de tokens
- Supervisor Solomon resolviendo conflictos entre roles
- Audit post-approval obligatorio — certifica el código antes de dar el OK
- Auto-detección de framework de tests, gestión automática de SonarQube, simplificación del pipeline según complejidad
- `kj audit` para análisis de salud del codebase en modo lectura
- Resiliencia ante caídas de proveedor (retry con backoff en 500/5xx)
- Quiet mode por defecto — output limpio sin ruido de stream-json

Si construyes algo con él, o si algo no funciona como está documentado, [abre un issue](https://github.com/manufosela/karajan-code/issues). Es lo más útil que puedes hacer ahora mismo.

---

**[@manufosela](https://github.com/manufosela)** es Head of Engineering en Geniova Technologies, co-organizador de [NodeJS Madrid](https://www.meetup.com/node-js-madrid/), y autor de *Liderazgo Afectivo* ([ES — Savvily](https://savvily.es/libros/liderazgo-afectivo/) | [EN — Amazon](https://www.amazon.com/dp/B0D7F4C8KC)). Ha publicado más de 90 paquetes npm.

Inspiraciones y agradecimientos: [Jorge del Casar](https://twitter.com/jorgecasar) (arquitectura hexagonal), [Joan León](https://twitter.com/nucliweb) (WebPerf Snippets, inspiración para el quality gate de rendimiento frontend).

[Karajan Code en GitHub](https://github.com/manufosela/karajan-code) · [karajancode.com](https://karajancode.com) · [npm](https://www.npmjs.com/package/karajan-code)
