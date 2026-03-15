---
title: Skills Mode
description: Use Karajan as Claude Code slash commands — no MCP server needed.
---

Karajan offers two modes of operation:

| Mode | Best for | Requires |
|------|----------|----------|
| **Skills** | Single AI agent, simpler setup | Only Claude Code |
| **Orchestrator** | Multi-agent pipeline, full control | MCP server + agent CLIs |

Skills mode installs Karajan roles as **slash commands** in Claude Code. Each command is a self-contained prompt with built-in guardrails — security checks, TDD enforcement, destructive operation detection, and diff verification.

## Installation

```bash
kj init
```

During setup, you'll be asked: *"Install Karajan skills as slash commands?"*. Say yes, and the skills are copied to `.claude/commands/` in your project.

You can also install them manually:

```bash
cp node_modules/karajan-code/templates/skills/*.md .claude/commands/
```

## Available Skills

### `/kj-run` — Full Pipeline

Executes all steps sequentially: discover → code → review → test → security → sonar → commit.

```
/kj-run Implement user authentication with JWT tokens
```

### `/kj-code` — Coder with Guardrails

Implements a task following TDD methodology with automatic quality checks:

- Tests first, then implementation
- Security check (no hardcoded secrets, no injection vectors)
- Destructive operation check (no `rm -rf`, `DROP TABLE`, etc.)
- Performance check (no sync I/O in handlers, no `document.write`)
- Diff verification (`git diff` confirms only intended changes)

```
/kj-code Add pagination to the user list endpoint
```

### `/kj-review` — Code Review

Reviews the current diff against quality standards. Auto-flags blocking issues:

- Hardcoded credentials or secrets
- Entire files overwritten instead of targeted edits
- Missing tests for changed source files
- SQL injection, XSS, command injection patterns

```
/kj-review Check changes in the auth module
```

### `/kj-test` — Test Quality Audit

Evaluates test coverage and quality for changed files:

- Verifies every changed source file has corresponding tests
- Runs the test suite and reports results
- Checks for empty tests, always-passing tests, skipped tests

```
/kj-test Audit test coverage for recent changes
```

### `/kj-security` — Security Audit

OWASP-focused security scan on the diff:

- Critical: hardcoded secrets, SQL/command injection, path traversal
- High: XSS, missing auth, SSRF, insecure deserialization
- Medium: missing input validation, verbose error messages, missing CSRF
- Low: missing security headers, known dependency vulnerabilities

```
/kj-security Scan auth changes for vulnerabilities
```

### `/kj-discover` — Gap Detection

Analyzes a task for missing information before coding begins:

- Missing requirements or acceptance criteria
- Implicit assumptions that need confirmation
- Ambiguities with multiple interpretations
- Contradictions in the specification

```
/kj-discover Review the requirements for the new billing module
```

### `/kj-architect` — Architecture Design

Proposes architecture before implementation:

- Architecture type and layer responsibilities
- API contracts and data model changes
- Tradeoffs with alternatives considered
- Clarification questions for stakeholders

```
/kj-architect Design the event-driven notification system
```

### `/kj-sonar` — Static Analysis

Runs SonarQube scan (if available) or manual static analysis:

- Cognitive complexity, duplicated code, unused imports
- Empty catch blocks, nested ternaries
- Quality gate status and issue breakdown

```
/kj-sonar Run quality analysis on current changes
```

## Skills vs Orchestrator

| Feature | Skills | Orchestrator |
|---------|--------|-------------|
| Setup | `kj init` → slash commands | MCP server registration |
| Agents | Host AI only | Multiple (Claude, Codex, Gemini, Aider, OpenCode) |
| Guardrails | In the prompt | In code (deterministic guards) |
| SonarQube | Manual or if Docker running | Integrated quality gate |
| Session management | None | Full (pause, resume, budget) |
| Cost tracking | None | Estimated per-session |
| Best for | Quick tasks, single developer | Complex tasks, CI/CD pipelines |

**Both modes can coexist** — use skills for quick tasks and the orchestrator for complex multi-agent work.
