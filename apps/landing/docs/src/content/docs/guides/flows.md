---
title: Pipeline Flows
description: Visual guide to Karajan's pipeline configurations, from minimal to full CI/CD with BecarIA Gateway.
head:
  - tag: script
    attrs:
      type: module
    content: |
      import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
      mermaid.initialize({ startOnLoad: true, theme: 'dark' });
---

Karajan adapts to your needs. Choose the flow that matches your workflow — from a simple one-shot coder to a fully automated CI/CD pipeline with PR-based reviews.

---

## 1. Minimal — Just Code

The simplest flow. A single AI agent writes code for your task. No review, no analysis.

<pre class="mermaid">
graph LR
    A[Developer] -->|kj code task| B[Coder]
    B --> C[Code changes]
    style A fill:#4a9eff,color:#fff
    style B fill:#10b981,color:#fff
    style C fill:#6366f1,color:#fff
</pre>

**When to use:** Quick prototypes, small scripts, exploratory coding.

```bash
kj code "add a utility function to parse dates" --coder claude
```

---

## 2. Code + Review Loop

The coder writes code, the reviewer checks it. If issues are found, the coder fixes them. This loop repeats until the reviewer approves.

<pre class="mermaid">
graph LR
    A[Developer] -->|kj run task| B[Coder]
    B --> C[Reviewer]
    C -->|approved| D[Done]
    C -->|issues found| B
    style A fill:#4a9eff,color:#fff
    style B fill:#10b981,color:#fff
    style C fill:#f59e0b,color:#fff
    style D fill:#6366f1,color:#fff
</pre>

**When to use:** Small to medium tasks where you want automated code review.

```bash
kj run "implement user login form" --coder claude --reviewer codex
```

---

## 3. Standard — With SonarQube

Adds static analysis between coder and reviewer. SonarQube catches bugs, code smells, and security issues before the review.

<pre class="mermaid">
graph LR
    A[Developer] -->|kj run task| B[Coder]
    B --> C[SonarQube]
    C -->|issues| B
    C -->|clean| D[Reviewer]
    D -->|approved| E[Tester]
    E --> F[Security]
    F --> G[Done]
    D -->|issues| B
    style A fill:#4a9eff,color:#fff
    style B fill:#10b981,color:#fff
    style C fill:#ef4444,color:#fff
    style D fill:#f59e0b,color:#fff
    style E fill:#8b5cf6,color:#fff
    style F fill:#ec4899,color:#fff
    style G fill:#6366f1,color:#fff
</pre>

**When to use:** Production code that needs quality assurance.

```bash
kj run "refactor payment service" --coder claude --reviewer codex
```

---

## 4. Intelligent — Triage + Solomon

The **Triage** agent analyzes task complexity and decides which pipeline roles to activate. **Solomon** supervises each iteration, detecting anomalies like scope drift or stalled progress.

<pre class="mermaid">
graph TD
    A[Developer] -->|kj run task| B[Triage]
    B -->|complex task| C[Planner]
    B -->|simple task| D[Coder]
    C --> D
    D --> E[SonarQube]
    E -->|clean| F[Reviewer]
    F -->|approved| G[Tester]
    G --> H[Security]
    H --> I[Done]
    F -->|issues| D
    E -->|issues| D
    J[Solomon] -.->|supervises| D
    J -.->|supervises| F
    J -.->|anomaly detected| K[Pause & Ask]
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

**When to use:** Complex tasks where you want the pipeline to adapt automatically.

```bash
kj run "redesign the API layer" --coder claude --reviewer codex --smart-models
```

---

## 5. BecarIA Gateway — PR as Source of Truth

The most powerful flow. A **GitHub App** acts as the identity for all pipeline agents. The PR becomes the single source of truth — every agent posts its results as comments and reviews directly on the PR.

<pre class="mermaid">
graph TD
    A[Developer] -->|kj run --enable-becaria| B[Triage]
    B --> C[Coder]
    C -->|commit + push| D[Create PR]
    D --> E[SonarQube]
    E --> F[Reviewer]
    F -->|reads PR diff| F
    F -->|approved| G[Tester]
    G --> H[Security]
    H --> I[Done]
    F -->|issues| C
    C -->|push fixes| D2[Incremental Push]

    D -->|dispatch| P[GitHub PR]
    C -.->|comment| P
    E -.->|comment| P
    F -.->|review APPROVE/REQUEST_CHANGES| P
    G -.->|comment| P
    H -.->|comment| P

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

### How it works

1. **First iteration:** Coder writes code → commit + push → PR created automatically
2. **Each agent** dispatches a `repository_dispatch` event to GitHub
3. A **GitHub Actions workflow** receives the event and posts comments/reviews using the **becaria-reviewer** GitHub App identity
4. **Reviewer** reads the PR diff (not local diff) and dispatches a formal `APPROVE` or `REQUEST_CHANGES` review
5. **Subsequent iterations:** Coder pushes fixes incrementally, each visible as commits on the PR

### Why a GitHub App?

The key insight: **the AI runs locally on your machine** (via CLI), but publishes results through a GitHub App bot identity. This means:

- **No AI API keys in CI/CD** — the AI runs locally, not in GitHub Actions
- **No GitHub Actions minutes consumed** for AI processing
- **Bot identity** — comments appear as `becaria-reviewer[bot]`, not as your personal account
- **Branch protection** — you can require the bot's approval before merging
- **Audit trail** — every pipeline decision is visible on the PR

```bash
# CLI
kj run "implement feature X" --enable-becaria --coder claude --reviewer codex

# Or via MCP
# kj_run({ task: "implement feature X", enableBecaria: true })
```

### Setup

```bash
# 1. Scaffold workflow files
kj init --scaffold-becaria

# 2. Create GitHub App "becaria-reviewer" with PR write permissions
# 3. Add secrets: BECARIA_APP_ID, BECARIA_APP_PRIVATE_KEY

# 4. Verify everything
kj doctor
```

---

## 6. Planning Game — Full Project Management

Integrates with the **Planning Game** project management system. Tasks are fetched automatically, status updates happen in real-time, and commits are tracked back to cards.

<pre class="mermaid">
graph TD
    PG[Planning Game] -->|prioritized task| A[Developer]
    A -->|kj run --pg-task ID| B[Pipeline Flow 4 or 5]
    B -->|auto status: In Progress| PG
    B --> C[Code + Review + Test]
    C -->|commits tracked| PG
    C -->|auto status: To Validate| PG
    C --> D[Done]
    style PG fill:#f97316,color:#fff
    style A fill:#4a9eff,color:#fff
    style B fill:#10b981,color:#fff
    style C fill:#6366f1,color:#fff
    style D fill:#8b5cf6,color:#fff
</pre>

**When to use:** Teams using agile/XP methodology with full traceability.

```bash
kj run "implement KJC-TSK-0042" --pg-task KJC-TSK-0042 --pg-project "My Project"
```

---

## Comparison Table

| Feature | Minimal | Code+Review | Standard | Intelligent | BecarIA | Planning Game |
|---------|:-------:|:-----------:|:--------:|:-----------:|:-------:|:-------------:|
| Coder | x | x | x | x | x | x |
| Reviewer | | x | x | x | x | x |
| SonarQube | | | x | x | x | x |
| Tester | | | x | x | x | x |
| Security | | | x | x | x | x |
| Triage | | | | x | x | x |
| Planner | | | | x | x | x |
| Solomon | | | | x | x | x |
| PR comments | | | | | x | x |
| Formal reviews | | | | | x | x |
| GitHub App bot | | | | | x | x |
| Auto-status | | | | | | x |
| Commit tracking | | | | | | x |
| **CLI command** | `kj code` | `kj run` | `kj run` | `kj run` | `kj run --enable-becaria` | `kj run --pg-task` |
