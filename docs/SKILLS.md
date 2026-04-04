# Karajan Code — Skills

Skills are knowledge capsules that agents load to enhance their capabilities. Installed globally via [OpenSkills](https://github.com/openskills-project).

## What are skills?

A skill is a markdown document with structured knowledge about a framework, language, or domain. When Karajan detects a skill is relevant (from task text, project files, or planner output), the skill's content is injected into the agent's prompt context.

Example: when you ask Karajan to build an Astro project, the `astro` skill teaches the coder about Astro's scoped styles, data attributes, `client:load` directives, and common patterns.

## Installation

```bash
npm install -g openskills
openskills install owner/repo        # from GitHub
openskills install owner/repo/skill  # specific skill from a repo
openskills list                      # show installed skills
openskills read skill-name           # view skill content
```

Karajan auto-detects installed skills at pipeline start. No per-project configuration required.

## Karajan's own skills

Shipped with karajan-code at `templates/skills/`:

| Skill | Purpose |
|-------|---------|
| `kj-run` | Pipeline execution patterns |
| `kj-code` | Coding conventions |
| `kj-review` | Code review criteria |
| `kj-test` | TDD workflow |
| `kj-plan` | Planning methodology |
| `kj-architect` | Architecture design |
| `kj-discover` | Task discovery (Mom Test, Wendel, JTBD) |
| `kj-audit` | Codebase audit |
| `kj-security` | Security best practices |
| `kj-sonar` | SonarQube usage |
| `kj-board` | HU Board workflow |
| `kj-csv-transform` | CSV transformation patterns |
| `kj-data-report` | Data reporting |
| `kj-sql-analysis` | SQL analysis |

## Recommended community skills

These are globally-installable skills that work well with Karajan:

### Frameworks
- `astro` — Astro components, scoped styles, integrations
- `frontend-design` — Web Components, vanilla JS patterns, design systems
- `impeccable` — Production-grade frontend quality

### Language-specific
Install the skill for your language when starting a project. Karajan's planner will identify which skills to install based on the task.

### Design & UX
- `optimize` — Performance optimization
- `audit` — Accessibility + quality audit
- `polish` — Visual polish
- `animate` — Micro-interactions
- `colorize` — Color systems
- `adapt` — Responsive design
- `bolder`, `quieter` — Design intensity tuning

## How Karajan uses skills

1. **Auto-detection** at pipeline start via `skill-detector.js`:
   - Reads `package.json` for framework dependencies
   - Reads config files (astro.config.mjs, tsconfig.json, etc.)
   - Scans task text + planner output for keywords
2. **Auto-install** via OpenSkills if not present (opt-in)
3. **Injection** into agent prompts via `skill-loader.js`
4. **Cleanup** of auto-installed skills after session (optional)

## Writing your own skill

Create `~/.agent/skills/<skill-name>/skill.md`:

```markdown
---
name: my-skill
description: Brief one-line description for agents to know when to use this
---

# My Skill

## When to use
...

## Patterns
...

## Examples
...
```

Karajan will load it when relevant.

## Links

- **OpenSkills**: https://github.com/openskills-project
- **Skill marketplace**: (community)
- **Karajan skill templates**: [templates/skills/](../templates/skills/)
