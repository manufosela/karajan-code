# El HU Board se llama Libretto: las historias de usuario son lo que la orquesta cuenta

Status: proposed
Date: 2026-10-24

## Context

La familia Karajan se nombra con la analogía de la orquesta: Karajan Code es el director, atril (ADR 0021) sostiene las partituras (skills, comandos y agentes), kaRAGan es la memoria y kaWATCHan el vigía. El HU Board no tenía papel en la metáfora y la landing no lo presenta como pieza. El usuario (24-oct) valoró Program Board, Repertorio, Cartelera y Temporada y eligió Libretto: el programa es solo el orden y el reparto; el libreto es la historia que se cuenta, y las historias de usuario son exactamente eso.

## Decision

La pieza pasa a llamarse Libretto en la familia. Cambia: el nombre en la landing (family.html, sección de cómo funciona, docs EN y ES), el nombre del paquete privado @karajan/hu-board a @karajan/libretto cuando se publique y las referencias de documentación a HU Board como producto. No cambia, para no romper a nadie: los comandos kj board y kj hu, la configuración hu_board en kj.config.yml, la base .karajan/hu-board.db, los IDs HU-<n> ni el término HU para una historia. El renombrado del código se hace en PRs atómicas por área, después de la landing. Alternativas: Program Board (conserva board y la gente lo reconoce, pero nombra el orden y no el contenido); Repertorio (es el backlog entero, no el tablero); Cartelera (lo que se anuncia, no lo que se trabaja); Temporada (es el sprint). Como si el código no existiera: llamarlo directamente kj stories y no forzar la analogía; se descarta porque la familia ya habla con esa metáfora y una pieza sin papel es la excepción que la debilita.

## Consequences

La landing cuenta la familia completa con una sola metáfora. Dos nombres conviven un tiempo (HU Board en código y config, Libretto en la familia), con la equivalencia dicha en la documentación. Renombrar el paquete y la base de datos es trabajo futuro con su propia card y migración.
