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
