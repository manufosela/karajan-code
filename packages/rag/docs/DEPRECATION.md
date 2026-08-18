# Política de deprecación

> Criterio de salida de la serie 0.x hacia la 1.0 (ver [ROADMAP](../ROADMAP.md)).

## El compromiso

A partir de la versión **1.0.0**, ningún símbolo de la API pública (los
re-exports de `index.js`, los subcomandos del CLI y sus flags, el formato de
`karajan.config.json`, el schema del manifest y el de la tabla pgvector) se
elimina ni cambia de forma incompatible sin **al menos 2 versiones minor de
preaviso**.

Ejemplo: algo deprecado en la `1.3.0` no puede eliminarse antes de la
`1.5.0`. Las majors (`2.0.0`) pueden eliminar todo lo que ya estuviera
deprecado, y solo lo que estuviera deprecado.

Durante la serie **0.x** (pre-1.0) los cambios breaking siguen permitidos en
cualquier minor, documentados en el CHANGELOG — es exactamente lo que
Semantic Versioning reserva al `0.x` y la razón de no haber declarado la 1.0
todavía.

## La convención (qué verás cuando algo se depreca)

Cada deprecación activa las tres señales a la vez:

1. **JSDoc**: el símbolo se marca con `@deprecated` indicando la versión de
   deprecación, la de eliminación prevista y la alternativa.
2. **CHANGELOG**: entra en la sección `### Deprecated` de la versión que la
   introduce, con la ruta de migración.
3. **Runtime**: la primera llamada en cada proceso emite un único aviso por
   `process.emitWarning` (tipo `DeprecationWarning`) vía el helper
   [`deprecate()`](../src/deprecation.js) — una sola vez, nunca spam, y
   silenciable con los mecanismos estándar de Node (`--no-deprecation`).

## El proceso de retirada

| Paso | Versión | Qué ocurre |
|------|---------|------------|
| Deprecación | `1.N.0` | Las tres señales se activan. El símbolo sigue funcionando igual. |
| Preaviso | `1.N+1.0` | Sigue funcionando. El CHANGELOG recuerda la retirada próxima. |
| Eliminación | `1.N+2.0` o posterior | El símbolo desaparece. El CHANGELOG lo lista en `### Removed`. |

- Los parches (`1.N.x`) nunca deprecan ni eliminan.
- Si una deprecación resulta errónea, se revierte sin coste (quitar las señales).
- Las correcciones de seguridad pueden acortar el ciclo **solo** si mantener
  el símbolo es en sí la vulnerabilidad; se explica en el CHANGELOG y en un
  aviso de seguridad.

## Qué NO cubre esta política

- Comportamiento interno no exportado en `index.js`.
- Los defaults de calidad (p. ej. el modelo por defecto de un adapter) —
  pueden actualizarse en minors, documentados como `### Changed`.
- Las dependencias `peer` opcionales y sus rangos de versión.
