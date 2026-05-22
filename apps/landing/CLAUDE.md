# Karajan Landing

Landing page and documentation site for [Karajan Code](https://github.com/manufosela/karajan-code), a multiagent coding orchestrator.

## Tech Stack

- **Landing**: Single-page HTML (`public/index.html`) — no framework, no build step
- **Docs**: Astro Starlight (`docs/`) — deployed at `/docs/`
- **Hosting**: Firebase Hosting
- **Fonts**: Inter (UI), JetBrains Mono (code)

## Design Context

### Users
Developers evaluating Karajan Code — typically senior engineers or tech leads looking for AI orchestration tooling. They arrive from GitHub, npm, or search. Their job: decide in under 30 seconds whether Karajan is worth installing. They value clarity, technical substance, and credibility over marketing flair.

### Brand Personality
**Technical, precise, reliable.** The robot mascot (conductor with baton and bow tie) adds warmth and memorability without undermining professionalism. The mascot is a character, not a cartoon — it should feel like an icon, not clip art.

### Aesthetic Direction
- **Visual tone**: Clean and restrained — closer to Raycast/Fig than to a marketing splash page. Polished but warm, character-driven.
- **Theme**: Dark-first with full light mode support. Both modes use the brand palette (steel blue + terminal green).
- **Anti-references**: Generic SaaS marketing pages with gradient blobs and stock photos. Overly playful or "startup-y" aesthetics. Neon/cyberpunk color schemes.
- **Emotion goal**: **Calm & clarity** — "I immediately understand what this does and how to start."

### Brand Palette
| Token              | Dark mode   | Light mode  | Usage                          |
|--------------------|-------------|-------------|--------------------------------|
| `--brand-green`    | `#34d399`   | `#059669`   | Primary accent, CTAs, success  |
| `--brand-steel`    | `#6b8fa3`   | `#6b8fa3`   | Secondary accent, links        |
| `--brand-steel-light` | `#8cb4c9` | —          | Subtle highlights (dark only)  |
| `--bg`             | `#0f1520`   | `#f4f7f9`   | Page background                |
| `--bg-card`        | `#1a2332`   | `#ffffff`   | Card/surface background        |
| `--text`           | `#e2e8f0`   | `#1a2a35`   | Primary text (14.8:1 / 13.7:1) |
| `--text-muted`     | `#9ca6ae`   | `#4c565c`   | Secondary text (7.4:1 / 7.0:1) |
| `--text-dim`       | `#94a4ac`   | `#48545c`   | Tertiary text (7.1:1 / 7.2:1)  |
| `--border`         | `#2a3a4e`   | `#d0dbe3`   | Borders and dividers           |

### Design Principles

1. **Clarity over cleverness** — Every element should communicate function instantly. If a visitor can't understand the page in 10 seconds, it's too complex.
2. **Substance over style** — Show the terminal demo, real stats, real commands. Developers trust evidence, not adjectives.
3. **Restraint is refinement** — Minimal color use, generous whitespace, no decorative elements without purpose. The mascot is the one allowed personality moment.
4. **Accessibility is non-negotiable** — Target WCAG AAA. High contrast in both themes, keyboard navigation everywhere, `prefers-reduced-motion` respected, semantic HTML throughout.
5. **Performance is a feature** — Single HTML file, no JS framework, responsive images with WebP, inline critical CSS. The page should feel instant.

## Documentation ordering rule — `fundamentals-first, recent-last`

**Regla obligatoria** (definida 2026-05-14 por el usuario tras el primer paso real por la landing):

Las páginas que acumulan entradas en el tiempo van en **orden ascendente cronológico** — lo más antiguo / fundamental arriba, los añadidos recientes al final. La razón: el visitante que aterriza llega a entender QUÉ es Karajan, no qué cambió en v2.14.3. Los detalles versión-específicos son progresivos al final, no la primera impresión.

Afecta a:

- **`docs/src/content/docs/architecture/history.md`** + `es/architecture/history.md` → `## Phase 1` arriba, `## Phase N` (la más reciente) al final, justo antes de `## Key Architectural Decisions` y `## References`. Cuando salga una nueva versión, AÑADIR la Phase nueva **al final** (antes de Architectural Decisions), NO al principio.
- **`docs/src/content/docs/index.mdx`** + `es/index.mdx` → `<CardGrid stagger>` empieza por los Cards fundamentales ("Multi-Agent Pipeline", "5 AI Agents", "MCP Server", "TDD", "Plugin System", "Zero API Costs"...) y termina con los Cards versión-específicos ("Planner self-fix loop (v2.14)"...). Cuando salga una nueva feature destacada, INSERTAR el `<Card>` nuevo **al final del CardGrid**, NO al principio.
- **Sección `## Recent releases` / `## Releases recientes`** (al final de `index.mdx` + `es/index.mdx`, después del `</CardGrid>`) → release notes en orden ascendente (versión más antigua primero). Cuando salga una versión nueva, AÑADIR un `### vX.Y.Z — Título` **al final** de la sección con el marcador `(current)` / `(actual)` en el título; quitarle el marcador a la anterior.
- Cualquier futura página tipo "Changelog feature highlights" o "Recent improvements" sigue la misma regla.

**Importante sobre el `hero.tagline`** (`index.mdx` frontmatter): tiene que ser **corto y atemporal** — descripción de QUÉ es Karajan, NO release notes. Las release notes específicas van en `## Recent releases`. Nunca pegues bloques de `vX.Y.Z — Patch ...` al tagline; el usuario ve el tagline ANTES de "¿Por qué Karajan?" y lo único que puede hacer un teaser de release notes ahí es enterrar la propuesta de valor. Tagline tipo `"Multiagent coding orchestrator. 24 roles, 5 agents, deterministic guards, TDD, SonarQube, automated review."` es el patrón.

Si en una actualización futura el patrón parece incorrecto, NO revertirlo sin preguntar — comprobar primero esta regla y la `feedback_landing_ordering.md` del MEMORY.md de `karajan-code`. El usuario rechazó explícitamente el 2026-05-14 la idea de poner release notes en el hero.
