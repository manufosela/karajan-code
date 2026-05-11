# Template — `kj refactorer`

## Cuándo usar este comando

Tienes código que **funciona pero está mal estructurado** y quieres mejorarlo sin cambiar el comportamiento externo. El refactorer:

- Mantiene el comportamiento observable idéntico (tests pasan antes y después)
- Mejora claridad / nombres / cohesión / acoplamiento / complejidad cognitiva
- NO añade features nuevas (eso es `kj run`)
- NO arregla bugs (eso es `kj run` con TDD)

## Comando

```bash
kj refactorer --task-file tasks/refactor-<modulo>.task.md
```

## Plantilla

Copia a `tasks/refactor-<modulo>.task.md`:

```markdown
# [REPLACE: refactorizar X — mejora de claridad sin cambio de comportamiento]

## Qué hay actualmente

[REPLACE: 1-2 párrafos describiendo el código actual y por qué te molesta.
EJEMPLO:
"`src/utils/parser.js` tiene una función `parse()` de 180 líneas con
6 niveles de nested if/else y 3 try/catch anidados. Funciona y tiene
buenos tests, pero cada vez que toco el módulo tengo que releer toda
la función. Cognitive complexity: 28 (Sonar lo flagea como hotspot)."]

## Qué quiero conseguir

[REPLACE: objetivo concreto.
EJEMPLO:
- Reducir cognitive complexity de `parse()` a <15.
- Funciones helper de máximo 30 líneas cada una.
- Sin nesting >3 niveles.
- Nombres descriptivos (en inglés).
- Mantener exactamente la misma API pública.]

## Restricciones no negociables

[REPLACE: lista concreta.
EJEMPLO:
- **Cero cambios en la API pública** de `parser.js`. Las firmas exportadas
  (`parse`, `parsePartial`, `ParseError`) son idénticas en input y output.
- **Todos los tests existentes pasan sin cambios**: `tests/parser.test.js`,
  `tests/parser-edge-cases.test.js`. NO tocar los tests salvo para añadir
  nuevos casos que cubran el código refactorizado.
- **Sin breaking de imports**: cualquier módulo que hace
  `import { parse } from "./utils/parser.js"` sigue funcionando.
- ≤200 LOC delta (regla del repo).
- Sin dependencias nuevas.]

## Qué SÍ puedes tocar

[REPLACE.
EJEMPLO:
- Extraer funciones internas (privadas al módulo).
- Renombrar variables locales y parámetros internos.
- Reorganizar el orden de definición de funciones.
- Cambiar implementación interna mientras el output sea idéntico.
- Añadir JSDoc/comments donde aporte claridad.]

## Qué NO debes tocar

[REPLACE.
EJEMPLO:
- Algoritmo: si actualmente usa regex, sigue usando regex; si usa parser
  recursivo, sigue siendo recursivo. NO migrar a una librería externa.
- Mensajes de error: el texto de los Error que se lanzan es contrato
  público (algunos tests lo verifican textualmente).
- Performance: NO optimizar — solo mejora de legibilidad. Si una mejora
  de legibilidad cuesta 2× tiempo de ejecución, prefiérela igualmente.]

## Criterios de aceptación

[REPLACE: 3-8 condiciones verificables.
EJEMPLO:
1. `npm test` pasa sin modificar ningún test existente.
2. `npx sonar-scanner` muestra cognitive complexity de cada función ≤15.
3. Coverage del módulo sigue ≥ que antes (medido en reports/coverage/).
4. `git diff src/utils/parser.js` no toca exports.
5. `git diff tests/` solo añade tests nuevos (si los hay), no modifica.]
```

## Patrón ganador

El refactorer funciona bien cuando le das:

- **Un módulo concreto y acotado** (uno o dos archivos máximo).
- **Tests existentes sólidos** (sin tests, el refactor es ciego — puedes romper sin enterarte).
- **Objetivo medible** (cognitive complexity, longitud, nesting).
- **Restricciones explícitas** de qué NO se puede cambiar.

Y mal cuando:

- "Refactoriza todo el proyecto" — demasiado scope.
- "Mejora la arquitectura" — eso es `kj architect`, no refactor.
- Falta de tests existentes — pídele al coder que añada tests PRIMERO en otra PR.

## Antiejemplo (qué NO funciona)

```markdown
Refactor src/ to be cleaner.
```

Problema: scope infinito, sin objetivo medible, sin restricciones. El refactorer hará cambios cosméticos masivos que romperán cosas sutiles. Mejor pide un módulo específico con un objetivo concreto.

## Verificación post-refactor

```bash
# 1. Tests verde
npm test

# 2. Cognitive complexity bajó
npx sonar-scanner   # o tu herramienta de complejidad preferida

# 3. La API pública NO cambió (diff de exports)
git diff main -- src/utils/parser.js | grep -E "^(\+|-)export"
# Esperado: vacío (NADA cambia en los exports)

# 4. Coverage mantenida o subida
npm test -- --coverage
```

Si cualquiera de estos falla, rechaza el PR o pide ajustes.
