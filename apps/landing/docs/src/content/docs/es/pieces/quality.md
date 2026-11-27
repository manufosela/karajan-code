---
title: Calidad antes de la revisión
description: Los controles deterministas que corren antes de que opine ningún modelo. Tests, tests debilitados, mutación y Sonar. Qué son, por qué existen, cuándo actúan, cómo se usan y qué no hacen.
---

## Qué es

Antes de que el revisor lea un diff, `kj review` pasa una serie de controles que no necesitan modelo. Responden preguntas con una respuesta fija: ¿pasan los tests del diff? ¿Ha perdido un test alguna aserción? ¿Ha encontrado Sonar algo grave en las líneas nuevas? Si uno falla, el diff se rechaza y ni siquiera se llama al revisor.

## Por qué existe

La opinión de un modelo cuesta tokens y puede equivocarse. Si un test está en rojo o no, no es una opinión. Así que primero van los hechos, cada uno barato y repetible, y al modelo solo se le pregunta lo que un hecho no puede decidir: si el código está bien.

Hay además un límite que kj reconoce: no puede comprobar que escribiste el test *antes* que el código (el orden de TDD no deja rastro en un diff). Lo que sí puede comprobar es lo que ese orden tiene que producir: código que llega con tests, tests que pasan, y tests que no se han debilitado para que pasen.

## Cuándo actúa

En `kj review --staged`, en este orden. El primero que rechaza termina la revisión:

| Control | Qué hace | Por defecto |
|---|---|---|
| **Tests con el código** | Código cambiado sin cambiar ningún test. Un diff que solo borra líneas o solo toca comentarios queda exento. | Avisa. Bloquea con `method_gates.tests_with_code: block`. |
| **Sonar** | Analiza los ficheros que el diff deja vivos. Un problema BLOCKER o CRITICAL en una línea que añade el diff rechaza; el resto es un consejo. | Activo (SonarQube en Docker). |
| **Sonar es obligatorio** | Un diff que toca código se rechaza si Sonar no ha corrido o no ha cubierto sus ficheros. Un diff solo de documentación pasa. | Siempre, para código. |
| **Mutación** | Muta el código cambiado y busca mutantes que los tests dejan vivir (aserciones flojas). | Apagado. `method_gates.mutation: warn` o `block`. |
| **Los tests del propio diff** | Ejecuta los ficheros de test que toca el diff (vitest, jest o pytest). En rojo rechaza sin llamar al modelo. | Siempre. |

Después el revisor lee el diff, con los hechos que kj ha calculado sobre él. Uno de ellos es **el test debilitado**: una aserción quitada de un test que ya existía.

- Si la aserción vuelve a aparecer en otro test del diff, se ha movido: no hay nada que decir.
- Si una aserción nueva sobre lo mismo la sustituye en ese fichero, se ha reescrito: se le dice al revisor, para que lo juzgue.
- Si no pasa ninguna de las dos, el test se ha debilitado: se le dice al revisor. Y cuando el cambio lo escribió `kj code`, su ejecución falla, porque el coder ha debilitado un test que ya existía.

## Cómo se usa

No pasas estos controles uno a uno: los pasa `kj review --staged`. Lo que haces tú:

- Mantén SonarQube en marcha (por defecto kj lo espera en `localhost:9000`; `kj sonar start` arranca su contenedor). Sin él, el código no pasa la revisión.
- Si de verdad Sonar no puede correr durante un tiempo, concedes tú, no el agente, una excepción con fecha desde tu terminal: `kj policy grant --rule method.sonar.code --until <fecha> --reason "<por qué>"`. No hay variable de entorno que lo salte.
- Decide si tests-con-el-código avisa o bloquea, y si quieres mutación, en `method_gates`.
- Ejecuta tú `kj mutate --since <base>` cuando quieras ver los mutantes supervivientes antes de la revisión.
- En cambios que tocan autenticación, entrada del usuario, secretos, red o dependencias, pasa antes `kj audit --security`. No usa modelo (inyección de prompts, OSV, Semgrep, Sonar) y renueva la marca de seguridad que comprueba el [Steward](/docs/es/pieces/steward/).

## Qué no hace

- **No juzga el diseño.** Que los controles estén en verde dice que el código corre y que no hay nada obvio mal, no que sea el código correcto. Eso es la [revisión cruzada](/docs/es/pieces/cross-review/).
- **No comprueba el orden de TDD.** Comprueba el resultado: los tests llegan con el código y siguen afirmando lo que afirmaban.
- **No mira el código viejo.** Sonar rechaza por problemas en las líneas que añade el diff; los de líneas que no ha tocado se informan como tendencia del fichero.
- **No ejecuta toda tu suite.** Solo los ficheros de test del propio diff. La suite completa corre en el CI.
