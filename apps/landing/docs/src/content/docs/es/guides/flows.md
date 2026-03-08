---
title: Flujos del Pipeline
description: Guía visual de las configuraciones del pipeline de Karajan, desde la mínima hasta CI/CD completo con BecarIA Gateway.
head:
  - tag: script
    attrs:
      type: module
    content: |
      import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
      mermaid.initialize({ startOnLoad: true, theme: 'dark' });
---

Karajan se adapta a tus necesidades. Elige el flujo que encaje con tu forma de trabajar — desde un simple coder hasta un pipeline CI/CD completamente automatizado con reviews en PRs.

---

## 1. Mínimo — Solo Código

El flujo más simple. Un único agente IA escribe código para tu tarea. Sin review, sin análisis.

<pre class="mermaid">
graph LR
    A[Developer] -->|kj code task| B[Coder]
    B --> C[Cambios en código]
    style A fill:#4a9eff,color:#fff
    style B fill:#10b981,color:#fff
    style C fill:#6366f1,color:#fff
</pre>

**Cuándo usarlo:** Prototipos rápidos, scripts pequeños, código exploratorio.

```bash
kj code "añadir función de utilidad para parsear fechas" --coder claude
```

---

## 2. Código + Review en Bucle

El coder escribe código, el reviewer lo revisa. Si encuentra problemas, el coder los corrige. El bucle se repite hasta que el reviewer aprueba.

<pre class="mermaid">
graph LR
    A[Developer] -->|kj run task| B[Coder]
    B --> C[Reviewer]
    C -->|aprobado| D[Listo]
    C -->|issues encontrados| B
    style A fill:#4a9eff,color:#fff
    style B fill:#10b981,color:#fff
    style C fill:#f59e0b,color:#fff
    style D fill:#6366f1,color:#fff
</pre>

**Cuándo usarlo:** Tareas pequeñas a medianas donde quieres revisión automática de código.

```bash
kj run "implementar formulario de login" --coder claude --reviewer codex
```

---

## 3. Estándar — Con SonarQube

Añade análisis estático entre el coder y el reviewer. SonarQube detecta bugs, code smells y vulnerabilidades de seguridad antes de la revisión.

<pre class="mermaid">
graph LR
    A[Developer] -->|kj run task| B[Coder]
    B --> C[SonarQube]
    C -->|issues| B
    C -->|limpio| D[Reviewer]
    D -->|aprobado| E[Tester]
    E --> F[Security]
    F --> G[Listo]
    D -->|issues| B
    style A fill:#4a9eff,color:#fff
    style B fill:#10b981,color:#fff
    style C fill:#ef4444,color:#fff
    style D fill:#f59e0b,color:#fff
    style E fill:#8b5cf6,color:#fff
    style F fill:#ec4899,color:#fff
    style G fill:#6366f1,color:#fff
</pre>

**Cuándo usarlo:** Código de producción que necesita garantía de calidad.

```bash
kj run "refactorizar servicio de pagos" --coder claude --reviewer codex
```

---

## 4. Inteligente — Triage + Solomon

El agente **Triage** analiza la complejidad de la tarea y decide qué roles del pipeline activar. **Solomon** supervisa cada iteración, detectando anomalías como desviación de alcance o progreso estancado.

<pre class="mermaid">
graph TD
    A[Developer] -->|kj run task| B[Triage]
    B -->|tarea compleja| C[Planner]
    B -->|tarea simple| D[Coder]
    C --> D
    D --> E[SonarQube]
    E -->|limpio| F[Reviewer]
    F -->|aprobado| G[Tester]
    G --> H[Security]
    H --> I[Listo]
    F -->|issues| D
    E -->|issues| D
    J[Solomon] -.->|supervisa| D
    J -.->|supervisa| F
    J -.->|anomalía detectada| K[Pausa y Pregunta]
    style A fill:#4a9eff,color:#fff
    style B fill:#14b8a6,color:#fff
    style C fill:#a855f7,color:#fff
    style D fill:#10b981,color:#fff
    style E fill:#ef4444,color:#fff
    style F fill:#f59e0b,color:#fff
    style G fill:#8b5cf6,color:#fff
    style H fill:#ec4899,color:#fff
    style I fill:#6366f1,color:#fff
    style J fill:#f97316,color:#fff
    style K fill:#dc2626,color:#fff
</pre>

**Cuándo usarlo:** Tareas complejas donde quieres que el pipeline se adapte automáticamente.

```bash
kj run "rediseñar la capa de API" --coder claude --reviewer codex --smart-models
```

---

## 5. BecarIA Gateway — PR como Fuente de Verdad

El flujo más potente. Una **GitHub App** actúa como identidad para todos los agentes del pipeline. La PR se convierte en la fuente única de verdad — cada agente publica sus resultados como comentarios y reviews directamente en la PR.

<pre class="mermaid">
graph TD
    A[Developer] -->|kj run --enable-becaria| B[Triage]
    B --> C[Coder]
    C -->|commit + push| D[Crear PR]
    D --> E[SonarQube]
    E --> F[Reviewer]
    F -->|lee diff del PR| F
    F -->|aprobado| G[Tester]
    G --> H[Security]
    H --> I[Listo]
    F -->|issues| C
    C -->|push fixes| D2[Push Incremental]

    D -->|dispatch| P[GitHub PR]
    C -.->|comentario| P
    E -.->|comentario| P
    F -.->|review APPROVE/REQUEST_CHANGES| P
    G -.->|comentario| P
    H -.->|comentario| P

    P --- BOT[becaria-reviewer bot]

    style A fill:#4a9eff,color:#fff
    style B fill:#14b8a6,color:#fff
    style C fill:#10b981,color:#fff
    style D fill:#6366f1,color:#fff
    style D2 fill:#6366f1,color:#fff
    style E fill:#ef4444,color:#fff
    style F fill:#f59e0b,color:#fff
    style G fill:#8b5cf6,color:#fff
    style H fill:#ec4899,color:#fff
    style I fill:#6366f1,color:#fff
    style P fill:#1f2937,color:#fff
    style BOT fill:#8b5cf6,color:#fff
</pre>

### Cómo funciona

1. **Primera iteración:** el Coder escribe código → commit + push → se crea la PR automáticamente
2. **Cada agente** envía un evento `repository_dispatch` a GitHub
3. Un **workflow de GitHub Actions** recibe el evento y publica comentarios/reviews usando la identidad de la GitHub App **becaria-reviewer**
4. **El Reviewer** lee el diff del PR (no el diff local) y envía un `APPROVE` o `REQUEST_CHANGES` formal
5. **Iteraciones siguientes:** el Coder hace push de los fixes incrementalmente, cada uno visible como commits en la PR

### ¿Por qué una GitHub App?

La idea clave: **la IA corre localmente en tu máquina** (vía CLI), pero publica resultados a través de una identidad de bot de GitHub App. Esto significa:

- **Sin API keys de IA en CI/CD** — la IA corre local, no en GitHub Actions
- **Sin consumo de minutos de GitHub Actions** para procesamiento de IA
- **Identidad de bot** — los comentarios aparecen como `becaria-reviewer[bot]`, no como tu cuenta personal
- **Branch protection** — puedes requerir la aprobación del bot antes de mergear
- **Auditoría completa** — cada decisión del pipeline es visible en la PR

```bash
# CLI
kj run "implementar feature X" --enable-becaria --coder claude --reviewer codex

# O vía MCP
# kj_run({ task: "implementar feature X", enableBecaria: true })
```

### Configuración

```bash
# 1. Crear los archivos de workflow
kj init --scaffold-becaria

# 2. Crear GitHub App "becaria-reviewer" con permisos de escritura en PRs
# 3. Añadir secrets: BECARIA_APP_ID, BECARIA_APP_PRIVATE_KEY

# 4. Verificar que todo está correcto
kj doctor
```

---

## 6. Planning Game — Gestión Completa de Proyecto

Se integra con [**Planning Game**](https://github.com/manufosela/planning-game-xp), un sistema de gestión de proyectos ágil (metodología XP) disponible como [servidor MCP](https://www.npmjs.com/package/planning-game-mcp). Las tareas se obtienen automáticamente, los estados se actualizan en tiempo real, y los commits se registran en las cards.

<pre class="mermaid">
graph TD
    PG[Planning Game] -->|tarea prioritaria| A[Developer]
    A -->|kj run --pg-task ID| B[Pipeline Flujo 4 o 5]
    B -->|auto estado: In Progress| PG
    B --> C[Código + Review + Test]
    C -->|commits registrados| PG
    C -->|auto estado: To Validate| PG
    C --> D[Listo]
    style PG fill:#f97316,color:#fff
    style A fill:#4a9eff,color:#fff
    style B fill:#10b981,color:#fff
    style C fill:#6366f1,color:#fff
    style D fill:#8b5cf6,color:#fff
</pre>

**Cuándo usarlo:** Equipos que usan metodología ágil/XP con trazabilidad completa.

```bash
kj run "implementar KJC-TSK-0042" --pg-task KJC-TSK-0042 --pg-project "Mi Proyecto"
```

---

## Tabla Comparativa

| Característica | Mínimo | Código+Review | Estándar | Inteligente | BecarIA | Planning Game |
|----------------|:------:|:-------------:|:--------:|:-----------:|:-------:|:-------------:|
| Coder | x | x | x | x | x | x |
| Reviewer | | x | x | x | x | x |
| SonarQube | | | x | x | x | x |
| Tester | | | x | x | x | x |
| Security | | | x | x | x | x |
| Triage | | | | x | x | x |
| Planner | | | | x | x | x |
| Solomon | | | | x | x | x |
| Comentarios en PR | | | | | x | x |
| Reviews formales | | | | | x | x |
| Bot GitHub App | | | | | x | x |
| Auto-estado | | | | | | x |
| Tracking de commits | | | | | | x |
| **Comando CLI** | `kj code` | `kj run` | `kj run` | `kj run` | `kj run --enable-becaria` | `kj run --pg-task` |
