# Auditoría de gates y escapes (septiembre y octubre de 2026)

KJC-TSK-0924. Pedida por el usuario el 3 de octubre: por qué hay tantos escapes, por qué de repente falla tanto, y si el camino es el correcto. Datos sacados del historial de `main` y del código, no de memoria.

## Los números

- Arreglos (`fix:`) en agosto: 47. Desde el 1 de septiembre hasta el 3 de octubre: 106.
- De esos 106, 53 son de gates (Sentinel, harden, review, policy, release). En agosto los gates casi no existían en esta forma.
- Escapes `KJ_ALLOW_*` distintos en el código: 15 reales (más `KJ_ALLOW_REAL_SCANS`, que es de tests, y `KJ_ALLOW_X`, que es un marcador de ejemplo).

## Por qué fallan los gates: las causas de los 53 arreglos

| Causa raíz | Arreglos | Ejemplos |
|---|---|---|
| El gate juzga un estado que no conoce bien (repo vacío, índice vacío, fichero nuevo, épica, fichero borrado, card partida) | ~10 | 0185, 0190, 0192, 0198, 0210, 0216, 0229, 0230, 0236 |
| El sello del supervisor frente a kj avanzando (procedencia, manipulación frente a desfase, árbol enlazado) | ~11 | 0161, 0169, 0193, 0197, 0211, 0212, 0222, 0224, 0259 |
| Un gate bloquea su propio arreglo | ~8 | 0165, 0170, 0178, 0186, 0200, 0204, 0207 |
| Leer comandos de shell como texto para impedir rodeos | ~8 | 0166, 0237, 0238, 0241, 0242, 0243 |
| Ficheros generados para stacks que no son el nuestro (eslint, prettier, commitlint, idioma de las guías) | ~8 | 0182, 0184, 0199, 0201, 0206, 0232, 0233, 0909 |
| Métricas que no coinciden entre sí (presupuesto de líneas, privacidad por fichero, limpieza de comentarios) | ~5 | 0203, 0205, 0208, 0235 |
| Firma del móvil y actos humanos | ~3 | 0164, 0168 |

**Lo que dicen estas causas:**
- Casi dos tercios no son "código mal hecho". Son gates que toman decisiones con información incompleta: un estado que no prevén, una versión de kj distinta de la que selló, o su propio arreglo como víctima. Cada gate nuevo tiene una superficie de estados que no se conoce hasta que lo usa un proyecto real.
- En septiembre pasaron dos cosas a la vez. Se añadieron gates muy rápido (RAG como gate, Sentinel ampliado, sello del supervisor, policy, release check). Y cuatro proyectos reales empezaron a usarlos a diario (grebla, PRESENTATION, TRIBBU, el colaborador de la issue #1886). Cada uno trae estados nuevos.
- La parte de leer shell es la única sin fondo. Codex encontró unos 25 rodeos en dos guards en un día, y cada rodeo cerrado abrió falsos positivos (el guard de carriles bloqueó una docena de comandos legítimos el mismo día).

## Por qué hay tantos escapes

Cada escape nació igual: un gate bloqueó algo legítimo y, en vez de arreglar el gate, se puso una puerta. El problema de diseño es que el agente puede activar la puerta él mismo, escribiendo `KJ_ALLOW_X=1` delante de su comando. Queda registrado, pero lo decide la misma IA a la que se vigila.

| Escape | Qué salta | Por qué existe | Destino propuesto |
|---|---|---|---|
| `KJ_ALLOW_NO_CARD` | card-first | método | eliminar: sin card no hay trabajo |
| `KJ_ALLOW_NO_RAG` | rag-first | falsos positivos del gate (fichero nuevo, índice vacío) | eliminar: los casos imposibles ya se resuelven en el gate |
| `KJ_ALLOW_NO_TESTS` | tests con el código | método | eliminar: es justo lo que el gate exige |
| `KJ_ALLOW_BOARD` | board-sync | pendientes falsos (épica, card partida) | eliminar: arreglados en el gate |
| `KJ_ALLOW_CROSS_LANE` | guard de carriles | falsos positivos de comillas | eliminar: arreglado en 0243; quedan los cruces reales, que son del humano |
| `KJ_ALLOW_WRITE`, `KJ_ALLOW_REWRITE` | Write sobre fichero existente | sobrescribir es legítimo a veces | eliminar: Edit sirve siempre |
| `KJ_ALLOW_PII` | privacidad | falsos positivos | arreglar el gate (lista de exclusión del proyecto, que ya existe) |
| `KJ_ALLOW_POLICY` | policy no evaluable | kj roto | eliminar: 0207 ya distingue "kj roto" de deny |
| `KJ_ALLOW_STEWARD` | estado del proyecto | bloqueo duro opcional | acto humano (es una decisión de proyecto) |
| `KJ_ALLOW_RELEASE` | release check | gates que bloqueaban su arreglo | eliminar tras 0204 y 0259 |
| `KJ_ALLOW_IDENTITY` | cuenta de git/gh | cuenta equivocada | eliminar: la cuenta correcta se pone en el comando |
| `KJ_ALLOW_NO_VERIFY` | `--no-verify` | hooks rotos | acto humano |
| `KJ_ALLOW_BASE_COMMIT` | commit en la rama base | bootstrap | eliminar: 0186 eximió el bootstrap |
| `KJ_ALLOW_LARGE_PR` | PR de más de 200 líneas | partir es lo correcto | acto humano: la etiqueta `large-pr-justified` en GitHub, que pone una persona |

Resultado: de 15 escapes, unos 10 sobran porque el gate ya resuelve el caso que los justificó. Los otros 4 o 5 son decisiones de proyecto que ya tienen su cauce humano fuera de la sesión. Ninguno necesita que el agente pueda activarlo.

## Si el camino es el correcto

El método es correcto: card, test primero, review cruzada atada al diff, PRs pequeñas y CI. Donde se impone en un punto de control que el agente no puede tocar (hooks de git, CI, protección de rama, el veredicto atado al diff), casi no falla.

Donde falla es la capa que vive dentro de la sesión e intenta interpretar cada llamada a una herramienta. Ahí está la mitad de los bugs de septiembre y casi todos los escapes. No es un problema de calidad del código: es pedirle a un lector de texto que entienda intenciones.

La propuesta concreta va en el ADR 0015.
