---
title: Architecture History
description: How Karajan Code's architecture has evolved over time.
---

This page documents the major architectural decisions and how Karajan Code evolved from a simple shell script orchestrator to a modular, multi-agent pipeline.

## Phase 1: Simple Orchestrator (v0.x)

**What it was:** A single script that ran Claude CLI on a task, then ran Codex CLI to review the output. No config, no sessions, no quality gates.

**Architecture:**
```
task → claude → diff → codex review → done
```

**Limitations:**
- Hardcoded to two agents (Claude + Codex)
- No retry on failure
- No cost tracking
- No SonarQube or testing integration
- Monolithic script, hard to extend

## Phase 2: Quality Gates (v1.0)

**What changed:** Added SonarQube static analysis as a mandatory step between coding and reviewing. Added TDD enforcement to ensure tests are written alongside code.

**Key additions:**
- SonarQube Docker integration (auto-start, scan, quality gate enforcement)
- TDD policy check (source changes require test changes)
- Configuration file (`kj.config.yml`) with first defaults
- Session tracking (basic run metadata)

**Architecture:**
```
task → coder → sonar → reviewer → done
                         ↑          │
                         └── loop ──┘
```

**Why:** Raw AI-generated code without quality gates often introduced code smells, skipped tests, or had security issues. SonarQube provided an objective, automated quality check independent of the reviewer.

## Phase 3: Role-Based Pipeline (v1.1)

**What changed:** Refactored from a monolithic orchestrator to a role-based architecture. Each pipeline responsibility became a discrete role with its own instructions, agent, and model.

**Key additions:**
- `BaseRole` abstraction (init → execute → report lifecycle)
- `BaseAgent` abstraction (uniform interface for all CLI agents)
- Agent registry (register, create, resolve)
- 11 configurable roles: triage, researcher, planner, coder, refactorer, sonar, reviewer, tester, security, solomon, commiter
- Review profiles (standard, strict, paranoid, relaxed)
- Role instructions as markdown templates (overridable)
- Repeat detection and fail-fast logic
- Solomon escalation for conflict resolution
- Budget tracking with estimated costs

**Architecture:**
```
triage? → researcher? → planner? → coder → refactorer? → sonar? → reviewer
                                                                      ↓
                                                         tester? → security? → commiter?
```

**Why:** The monolithic orchestrator had become difficult to maintain and extend. Adding a new capability (like security audits) meant modifying the core loop. The role-based pattern made each responsibility independently testable and configurable.

**Inspiration:** [jorgecasar/legacy-s-end-2/packages/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) uses a clean hexagonal architecture with:
- **Domain layer**: Models and port interfaces
- **Use-cases**: plan-issue, implement-issue, review-pr, check-task-readiness, track-cost-report
- **Infrastructure**: Adapters for Anthropic, Gemini, OpenAI, GitHub, GitCli

This influenced Karajan's separation between the agent interface (`BaseAgent` as port) and concrete implementations (Claude, Codex, Gemini, Aider as adapters). The role system parallels the use-case layer — each role is a self-contained orchestration unit.

## Phase 4: MCP Server (v1.2)

**What changed:** Added a Model Context Protocol (MCP) server so Karajan can be used from within AI agents (Claude Code, Codex) rather than only from the terminal.

**Key additions:**
- MCP stdio server with 11 tools (kj_run, kj_code, kj_review, etc.)
- Real-time progress notifications via MCP logging
- Auto-registration in Claude Code and Codex
- Orphan guard to prevent zombie processes
- Session pause/resume via MCP (`kj_resume`)

**Architecture addition:**
```
┌──────────────────┐
│ AI Agent (Claude) │
│                  │──── MCP (stdio) ────→ karajan-mcp ──→ CLI subprocess
│                  │←─── progress/result ─┘
└──────────────────┘
```

**Why:** The most powerful way to use Karajan is not from the terminal, but from within an AI agent's conversation. The MCP server lets Claude or Codex delegate complex tasks to Karajan's pipeline, receive real-time progress updates, and get structured results — all without leaving the conversation.

## Phase 5: Extensibility (v1.3)

**What changed:** Plugin system, Planning Game integration, and production hardening.

**Key additions:**
- Plugin system: `.karajan/plugins/*.js` for custom agents
- Planning Game MCP integration (card enrichment, status updates)
- Retry with exponential backoff and jitter
- Session cleanup (auto-expire old sessions)
- Git automation (auto-commit, auto-push, auto-PR, auto-rebase)
- Reviewer fallback chain (primary → fallback → Solomon)
- Environment variable overrides (`KJ_HOME`, `KJ_SONAR_TOKEN`)

**Why:** Users needed to integrate Karajan into their existing workflows — project management (Planning Game), custom AI tools (plugins), and CI/CD (git automation). The plugin system was particularly important: it allows anyone to wrap their own CLI tool as a Karajan agent without modifying the core codebase.

## Key Architectural Decisions

### CLI wrapping vs direct API calls

Karajan wraps existing AI agent CLIs (claude, codex, gemini, aider) rather than calling AI provider APIs directly.

**Advantages:**
- Uses your existing subscriptions — no separate API keys needed
- Predictable cost — you pay your plan rate, not per-token
- Agents handle their own context management, tool use, and safety features
- Upgrades automatically when you update the CLI

**Trade-offs:**
- Less granular control over prompts and parameters
- Cost tracking is estimated, not actual billing
- Rate limiting is handled by the CLI, not Karajan

### Markdown-based role instructions

Role instructions (what to do, how to review, what rules to enforce) are stored as `.md` files, not hardcoded.

**Advantages:**
- Users can override any role without touching code
- Three-level resolution: project → user → built-in
- Easy to version control and share
- Non-developers can modify review rules

### Session persistence on disk

All session state is written to disk as JSON files, not kept in memory.

**Advantages:**
- Survives crashes and restarts
- Enables pause/resume across sessions
- Enables post-run reporting and audit trails
- No database dependency

### Estimated budget tracking

Token usage is counted and costs are estimated using published pricing rates, rather than querying actual API billing.

**Advantages:**
- Works with CLI agents that don't expose billing data
- Provides relative cost comparison between approaches
- Enables budget guardrails (warn at 80%, stop at 100%)

**Trade-off:** Reported costs are approximate — useful for comparison and guardrails, not for invoicing.

## References

- [jorgecasar/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) — Hexagonal architecture patterns (ports & adapters) that influenced the agent adapter design
- [ADR-001: Role-Based AI Architecture](/docs/architecture/overview/) — Architecture decision record in the karajan-code repository
- [Model Context Protocol](https://modelcontextprotocol.io/) — The standard used for Karajan's MCP server integration
