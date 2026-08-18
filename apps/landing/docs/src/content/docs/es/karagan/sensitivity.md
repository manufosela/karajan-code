---
title: 'Sensibilidad y privacidad'
description: 'Niveles public/internal/confidential por corpus o prefijo, routing de proveedores por policy y redacción PII en profundidad.'
---

<!-- synced-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · section-sha256: c00a67b395fc4e0a1fcbad2e1e3ab4d08cdb4aea0fa50af7e0f97ebe00bad2e7
     NO EDITAR A MANO — regenerado con `npm run sync:family-docs` -->

Desde 0.7.0 la capa easy aplica la [sensitivity policy](https://github.com/manufosela/karajan-rag/blob/v1.5.0/docs/security/sensitivity-audit.md)
de punta a punta (ADR-005 §6). Declara el nivel de tu corpus en
`karajan.config.json`:

```json
{
  "easy": {
    "sensitivity": "internal",
    "sensitivityRules": [
      { "prefix": "docs/public/", "level": "public" },
      { "prefix": "finanzas/", "level": "confidential" }
    ]
  }
}
```

- **Niveles**: `public` | `internal` | `confidential`. Sin declarar nada,
  todo cuenta como `internal` (default seguro: nunca se asume público).
  Las reglas por prefijo son excepciones; gana la primera que matchea.
- **Al indexar**, cada documento queda marcado con su nivel y los chunks
  lo heredan en el store.
- **En `query --answer`**, el nivel efectivo es el **máximo** de los
  chunks recuperados: un solo chunk `confidential` en el contexto hace
  confidential a toda la respuesta. La policy por defecto permite:
  `confidential → ollama` (local), `internal → ollama y nubes privadas`,
  `public → cualquier proveedor`.
  - `--adapter` explícito no permitido para el nivel → **error** con la
    lista de permitidos (nunca se degrada en silencio lo que pediste).
  - Adapter de config/default no permitido → se enruta al primer
    proveedor permitido, avisando por stderr.
- **En `eval --judges`**, declara el nivel con `--sensitivity` (default
  `internal`); los jueces no permitidos se rechazan antes de enviar nada.
- **Defensa en profundidad**: todo lo que sale hacia un LLM va además por
  `redactPII` (emails, teléfonos, NIF/NIE, tarjetas, IBAN).
- Índices creados antes de 0.7.0 no tienen marca: sus chunks cuentan como
  `internal`. Reindexa para aplicar tus reglas.
