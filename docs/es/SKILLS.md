# Karajan Code — Skills

Los skills son cápsulas de conocimiento que los agentes cargan para mejorar sus capacidades. Se instalan globalmente vía [OpenSkills](https://github.com/openskills-project).

## ¿Qué son los skills?

Un skill es un documento markdown con conocimiento estructurado sobre un framework, lenguaje o dominio. Cuando Karajan detecta que un skill es relevante (del texto de la tarea, ficheros del proyecto o output del planner), el contenido del skill se inyecta en el contexto del prompt del agente.

Ejemplo: cuando pides a Karajan construir un proyecto Astro, el skill `astro` enseña al coder sobre estilos scoped de Astro, atributos de datos, directivas `client:load` y patrones comunes.

## Instalación

```bash
npm install -g openskills
openskills install owner/repo        # desde GitHub
openskills install owner/repo/skill  # skill específico de un repo
openskills list                      # mostrar skills instalados
openskills read skill-name           # ver contenido del skill
```

Karajan auto-detecta los skills instalados al arrancar el pipeline. No requiere configuración por proyecto.

## Skills propios de Karajan

Incluidos con karajan-code en `templates/skills/`:

| Skill | Propósito |
|-------|-----------|
| `kj-run` | Patrones de ejecución del pipeline |
| `kj-code` | Convenciones de codificación |
| `kj-review` | Criterios de code review |
| `kj-test` | Workflow TDD |
| `kj-plan` | Metodología de planificación |
| `kj-architect` | Diseño de arquitectura |
| `kj-discover` | Discovery de tareas (Mom Test, Wendel, JTBD) |
| `kj-audit` | Auditoría de codebase |
| `kj-security` | Buenas prácticas de seguridad |
| `kj-sonar` | Uso de SonarQube |
| `kj-board` | Workflow del HU Board |
| `kj-csv-transform` | Patrones de transformación CSV |
| `kj-data-report` | Reporting de datos |
| `kj-sql-analysis` | Análisis SQL |

## Skills de comunidad recomendados

Skills instalables globalmente que funcionan bien con Karajan:

### Frameworks
- `astro` — componentes Astro, estilos scoped, integraciones
- `frontend-design` — Web Components, patrones vanilla JS, design systems
- `impeccable` — calidad frontend de producción

### Específicos de lenguaje
Instala el skill de tu lenguaje al empezar un proyecto. El planner de Karajan identificará qué skills instalar según la tarea.

### Diseño y UX
- `optimize` — optimización de performance
- `audit` — auditoría de accesibilidad + calidad
- `polish` — pulido visual
- `animate` — micro-interacciones
- `colorize` — sistemas de color
- `adapt` — diseño responsive
- `bolder`, `quieter` — ajuste de intensidad de diseño

## Cómo usa Karajan los skills

1. **Auto-detección** al arrancar el pipeline vía `skill-detector.js`:
   - Lee `package.json` para dependencias de framework
   - Lee ficheros de config (astro.config.mjs, tsconfig.json, etc.)
   - Escanea texto de tarea + output del planner en busca de keywords
2. **Auto-install** vía OpenSkills si no están presentes (opt-in)
3. **Inyección** en prompts de agentes vía `skill-loader.js`
4. **Limpieza** de skills auto-instalados tras la sesión (opcional)

## Escribir tu propio skill

Crea `~/.agent/skills/<skill-name>/skill.md`:

```markdown
---
name: my-skill
description: Descripción breve de una línea para que los agentes sepan cuándo usarlo
---

# Mi Skill

## Cuándo usar
...

## Patrones
...

## Ejemplos
...
```

Karajan lo cargará cuando sea relevante.

## Enlaces

- **OpenSkills**: https://github.com/openskills-project
- **Marketplace de skills**: (comunidad)
- **Templates de skills de Karajan**: [templates/skills/](../../templates/skills/)
