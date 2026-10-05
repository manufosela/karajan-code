# Las reglas de fuentes privadas no viajan en el rules.yml versionado

Status: proposed
Date: 2026-10-05

## Context

ADR 0016 compila las reglas de los MD en `.karajan/rules.yml`, que se versiona con el repo. El inventario lee también fuentes privadas del usuario: su CLAUDE.md global y sus memorias de feedback. Cada regla compilada cita su texto literal y su fuente, así que aprobar y commitear una propuesta publicaría en un repo público textos privados: citas del usuario, incidentes, nombres de clientes y rutas de su home. Visto el 2026-10-05 al generar el primer esqueleto real de este repo: 120 reglas, 103 de fuentes privadas.

## Decision

PROPUESTA, pendiente del usuario. Dos ficheros: `rules.yml`, versionado, solo con reglas cuya fuente está dentro del proyecto; y `rules.local.yml`, fuera de git, con las reglas de fuentes externas al proyecto. El gate evalúa los dos. `kj rules approve` reparte cada regla por su fuente. Los dos quedan protegidos de la sesión por gobernanza.

### Una compilación floja no se aprueba sin verse

Añadido el 2026-10-05, a petición del usuario. Las reglas solo deniegan, así que dos que se contradicen bloquean de más, nunca de menos, y ninguna deja de aplicar. La puerta libre real es otra: que el agente vigilado compile una regla en algo que no dispara (una condición demasiado estrecha, o una regla vigilable marcada como de criterio o fuera de alcance) y el humano lo apruebe sin notarlo. Los ejemplos de una regla los escribe el mismo agente, así que por sí solos no lo impiden. Tres defensas:

1. **Revisión por otra IA.** La propuesta la revisa un modelo distinto del que la escribió, regla a regla, con una pregunta: ¿esta condición cubre lo que dice el texto? Sin ese veredicto, atado a los bytes de la propuesta, `kj rules approve` no la ofrece.
2. **Degradar no pasa en silencio.** Si una regla ya aprobada como determinista vuelve como de criterio, fuera de alcance o con otra condición, `kj rules approve` lo enseña aparte y lo primero.
3. **Lo no vigilado, a la vista.** `kj rules approve` lista antes que nada las reglas sin gate efectivo (fuera de alcance y de criterio), separadas del resto.

## Consequences

Las reglas privadas no las hereda el equipo ni otra máquina: cada persona aprueba las suyas. La cobertura cruza los dos ficheros. Alternativas descartadas: omitir el texto de las privadas, porque el deny dejaría de citar la regla; y dejar un solo fichero confiando en el escáner de privacidad, que solo detecta formas conocidas y no una cita o un nombre de cliente.

La revisión cruzada cuesta tokens en cada compilación y añade un paso antes de aprobar; a cambio, quien propone la compilación deja de ser quien la da por buena.

Mientras no se decida, nadie debería aprobar y commitear una propuesta que incluya reglas de fuentes privadas en un repo público.
