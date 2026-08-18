# Config del self-test de los workflows reusables

Los repos observados son dos repos **públicos y reales** de la familia, así
el ejercicio es de verdad sin necesitar una organización aparte ni
credenciales especiales, y hay cross-repo: el diff de uno se contrasta
contra el corpus del otro.

- **Store `lancedb`**: sin infraestructura que montar.
- **Sin `notify.targets`** a propósito: el self-test no debe comentar jamás
  en una PR real.

Esta explicación vive aquí y no dentro del JSON porque la validación del
config es estricta y rechaza claves desconocidas — incluido un `_comment`.
Es deliberado (una clave mal escrita debe fallar, no ignorarse), pero
significa que **un config no se puede documentar por dentro**.
