# Las reglas de fuentes privadas no viajan en el rules.yml versionado

Status: proposed
Date: 2026-10-05

## Context

ADR 0016 compila las reglas de los MD en `.karajan/rules.yml`, que se versiona con el repo. El inventario lee también fuentes privadas del usuario: su CLAUDE.md global y sus memorias de feedback. Cada regla compilada cita su texto literal y su fuente, así que aprobar y commitear una propuesta publicaría en un repo público textos privados: citas del usuario, incidentes, nombres de clientes y rutas de su home. Visto el 2026-10-05 al generar el primer esqueleto real de este repo: 120 reglas, 103 de fuentes privadas.

## Decision

PROPUESTA, pendiente del usuario. Dos ficheros: `rules.yml`, versionado, solo con reglas cuya fuente está dentro del proyecto; y `rules.local.yml`, fuera de git, con las reglas de fuentes externas al proyecto. El gate evalúa los dos. `kj rules approve` reparte cada regla por su fuente. Los dos quedan protegidos de la sesión por gobernanza.

## Consequences

Las reglas privadas no las hereda el equipo ni otra máquina: cada persona aprueba las suyas. La cobertura cruza los dos ficheros. Alternativas descartadas: omitir el texto de las privadas, porque el deny dejaría de citar la regla; y dejar un solo fichero confiando en el escáner de privacidad, que solo detecta formas conocidas y no una cita o un nombre de cliente.

Mientras no se decida, nadie debería aprobar y commitear una propuesta que incluya reglas de fuentes privadas en un repo público.
