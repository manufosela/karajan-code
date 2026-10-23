# Karajan en equipo: el HU Board compartido vive en GitHub Issues

Status: accepted
Date: 2026-10-23
Accepted: 2026-10-23, by the maintainer

## Context

Épica KJC-PCS-0101. kj es individual: kj hu add toma el primer HU-NNNN libre del plan local (src/commands/hu.js), así que dos personas en el mismo repo crean IDs que chocan y ninguna ve lo que la otra tiene en marcha. Lo vivieron el mantenedor y Jorge del Casar el 23-oct trabajando a la vez en karajan-code. El usuario eligió GitHub Issues como backend.

## Decision

Cada HU es una issue del repo: su número es el ID (único por construcción), el asignado es la reserva visible de quién la tiene en marcha, y el estado va en etiquetas kj (pending, running, done, failed, skipped). kj hu add crea la issue y kj hu move cambia etiqueta y asignado; reservar una HU ya asignada a otra persona falla en voz alta. El board local pasa a ser copia y vista: se sincroniza con las issues y sin red guarda los cambios en cola y los aplica después, nunca inventa un ID local. La referencia a la card del Planning Game viaja en la issue. Alternativas: Firebase (tiempo real y web propia, pero autenticación, reglas y alta de colaboradores por proyecto que hay que construir y mantener); y, como si el código no existiera, un fichero de board versionado en el repo, que se descarta porque dos ramas lo editan a la vez y chocan en cada merge. Gana GitHub Issues porque no añade infraestructura, gh ya autentica a cada persona, GitHub resuelve la concurrencia y funciona igual en cualquier repo que use kj.

## Consequences

Los IDs nuevos dejan de ser HU-NNNN y pasan a ser el número de issue; las HUs locales existentes se migran una vez creando su issue. kj necesita red para reservar (sin red, la reserva queda pendiente y se avisa). Las issues de HU se mezclan con las de bugs y peticiones del repo, separadas por la etiqueta kj:hu. Un repo sin GitHub (u otro forge) sigue con el board local hasta tener su adaptador.
