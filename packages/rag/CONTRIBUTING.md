# Contribuir a Karajan RAG

Gracias por considerar contribuir. Este documento resume lo mínimo para
abrir Pull Requests alineados con el proyecto.

## Setup local

```bash
pnpm install
pnpm test       # unit tests (node:test)
pnpm coverage   # tests con c8 coverage
pnpm lint       # ESLint flat config
```

Requisitos:
- Node.js **18+** (recomendado 20 o 22 LTS — CI usa matriz de ambas).
- [pnpm](https://pnpm.io).

## Estilo de código

- **Vanilla JavaScript** con **JSDoc** para tipos. No TypeScript.
- **ES2025+**. APIs deprecadas (`var`, `substr`, `escape`/`unescape`,
  `alert`/`confirm`/`prompt`) están prohibidas y ESLint las bloqueará.
- Preferir `const`, arrow functions, template literals, optional chaining,
  nullish coalescing.
- Estructura SOLID/DRY/KISS/YAGNI. Sin fallbacks silenciosos.

## Workflow

1. Crea una rama por tarea: `feat/KJR-TSK-XXXX-descripcion` o
   `fix/KJR-TSK-XXXX-descripcion`.
2. Mantén los PRs **atómicos** y pequeños (<300 líneas ideal).
3. **Tests obligatorios**: si añades funcionalidad, añade tests; si tocas
   algo con tests, ejecútalos antes de pushear.
4. **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
   `chore:`. Subject <70 chars. El mensaje completo debe aclarar el *por qué*,
   no solo el *qué*.
5. Nunca incluir referencias a herramientas de IA generativa en mensajes de
   commit o PR.
6. Abre PR a `main`. CI (Node 20 + Node 22 + lint + tests) debe quedar en
   verde antes de mergear.

## ADRs

Decisiones arquitectónicas relevantes se documentan como ADR en
`docs/adrs/` y se registran en el Planning Game. Ver los ADRs existentes
([ADR-001](./docs/adrs/ADR-001-kjc-reuse-strategy.md),
[ADR-002](./docs/adrs/ADR-002-reindex-policy.md),
[ADR-003](./docs/adrs/ADR-003-solomon-slot.md) _(superseded)_,
[ADR-004](./docs/adrs/ADR-004-solomon-implementation.md)) antes de cambiar
conceptos transversales.

## Planning Game

La gestión de backlog se hace en una instancia privada de **Planning Game**
(XP). Cada PR debe referenciar el `KJR-TSK-XXXX` que resuelve en el título
y en el cuerpo. Si no tienes acceso al board, abre un issue primero.

## Seguridad

Para reportar vulnerabilidades, sigue las instrucciones de
[SECURITY.md](./SECURITY.md) — **no abras issues públicos** con detalles
explotables.

## Licencia

Al contribuir aceptas que tu código se licencie como
**AGPL-3.0-or-later**, igual que el resto del proyecto.
