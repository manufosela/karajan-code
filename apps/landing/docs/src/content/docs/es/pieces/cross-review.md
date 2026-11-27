---
title: La revisión cruzada
description: Cada diff lo revisa otra IA, distinta, antes del commit, con el veredicto atado a ese diff exacto. Qué es, por qué existe, cuándo actúa, cómo se usa y qué no hace.
---

## Qué es

Antes de commitear un cambio, lo revisa otra IA. `kj review --staged` le manda el diff preparado al revisor de tu panel, que lo aprueba o lo rechaza con hallazgos. La respuesta es un **veredicto**, y va atado a ese diff exacto: kj lo identifica por un hash del diff y lo guarda en `.karajan/reviews/`.

Tu panel dice quién hace qué. Por defecto el coder es Claude y el revisor es Codex; una tercera IA arbitra los desacuerdos (Solomon). Lo fijas en la configuración, y kj avisa en cada revisión cuando algo fija un revisor distinto.

## Por qué existe

Un agente que revisa su propio trabajo encuentra lo que ya cree. Escribió el código con una idea en la cabeza, y lo lee con esa misma idea. Un modelo distinto tiene otros puntos ciegos, así que ve lo que el primero no podía ver.

El veredicto va atado al diff para que no se pueda reutilizar: cambias una línea y el hash cambia, así que el cambio hay que revisarlo otra vez. "Estaba aprobado" siempre quiere decir "esto estaba aprobado".

## Cuándo actúa

| Momento | Qué pasa |
|---|---|
| **Antes del commit** | `kj review --staged` pasa primero los [controles de calidad](/docs/es/pieces/quality/) y luego el revisor. El primer rechazo lo termina y se guarda como veredicto. |
| **En el commit** | El hook de git (`kj review --check`) y el Sentinel solo dejan pasar el commit con un veredicto aprobado para exactamente el diff preparado. |
| **En la pull request** | `kj review --publish-pr <n>` publica el veredicto de cada commit con su hash. El workflow `kj-verdicts` recalcula el hash de cada commit y falla si alguno no tiene veredicto, así que un commit hecho con `--no-verify` se pilla aquí. |

Un diff demasiado grande para un solo prompt se revisa en lotes de ficheros enteros (hasta 10). Solo se aprueba si se aprueban todos los lotes; un fichero demasiado grande para revisarlo se convierte en un hallazgo que bloquea, nunca en un aprobado en silencio. Cada lote recibe los hechos de sus propios ficheros: cosas que kj calcula sin modelo (el tamaño, una dependencia nueva, algo con forma de secreto, una aserción quitada de un test) y que le da al revisor para que las mire.

## Cómo se usa

1. Prepara tu cambio por nombre y ejecuta `kj review --staged`.
2. Aprobado: haz el commit. Rechazado: arregla los hallazgos y revisa otra vez. Una corrección de la otra IA es el método funcionando.
3. Si crees que un hallazgo está mal, no lo discutas en el código: `kj solomon --position "<por qué>"` se lo pregunta a una tercera IA. El árbitro tiene que ser distinto del que escribió y del que revisó. Si te da la razón, el mismo diff recibe un veredicto aprobado. Con `--finding <id>` solo se arbitra ese hallazgo.

**Un hallazgo de seguridad nunca se arbitra.** Si el revisor lo marca como de seguridad, o habla de inyección, secretos, autenticación y similares, ni siquiera se llama a Solomon: hay que arreglarlo.

## Qué no hace

- **No revisa un diff que no ha visto.** Un veredicto es para un hash. Haz un rebase, un amend o añade una línea, y el veredicto deja de valer.
- **No deja que el agente de tu sesión se revise a sí mismo.** kj nunca elige como revisor al agente anfitrión; si no hay otro disponible, la revisión falla en vez de caer en una autorrevisión. Eso sí, no comprueba que el revisor sea distinto del coder que declara tu panel, así que mantén esos dos distintos.
- **No sustituye a tus tests.** El revisor lee el código; los [controles de calidad](/docs/es/pieces/quality/) lo ejecutan antes.
- **No guarda los veredictos para siempre.** Caducan a los 14 días; nada preparado espera tanto.
