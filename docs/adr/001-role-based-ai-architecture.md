# ADR-001: Role-Based AI Architecture

**Status:** Proposed
**Date:** 2026-02-24
**Task:** KJC-TSK-0025

## Context

Karajan Code currently has a flat architecture where the orchestrator directly manages coder, reviewer, and sonar in a monolithic loop. As we add more specialized capabilities (research, testing, security, git automation, conflict resolution), the orchestrator becomes increasingly complex and tightly coupled.

We need a modular architecture where each AI capability is encapsulated in a **role** with clear responsibilities, standard lifecycle, and defined communication protocols.

## Decision

Adopt a **role-based architecture** with 10 specialized roles coordinated by a central orchestrator (Karajan).

## Roles

### 1. Karajan (Orchestrator)
- **Type:** AI + coordinator
- **Responsibility:** Global vision, pipeline coordination, human interface, context management
- **Input:** Task from user/MCP
- **Output:** Final result with summary of all phases
- **Decides:** Which roles to activate, in what order, when to skip optional roles

### 2. Researcher
- **Type:** AI
- **Responsibility:** Investigate codebase, architecture, dependencies, and existing patterns before planning
- **Input:** Task description, project context
- **Output:** Research report (affected files, patterns, constraints, prior decisions)
- **Activates:** When Karajan determines the task needs context gathering (configurable: always, auto, never)

### 3. Planner
- **Type:** AI
- **Responsibility:** Create implementation plan using Researcher's findings
- **Input:** Task + research report (if available)
- **Output:** Implementation plan (approach, steps, risks, out-of-scope)
- **Activates:** When devPoints >= 3 or task complexity warrants it

### 4. Coder
- **Type:** AI
- **Responsibility:** Write code and tests following TDD methodology
- **Input:** Task + plan (if available) + feedback from previous iterations
- **Output:** Code changes (files modified/created)
- **Constraints:** Must follow coder.md instructions, TDD when methodology=tdd

### 5. Sonar (non-AI)
- **Type:** Tool wrapper (SonarQube Docker)
- **Responsibility:** Static analysis, quality gate evaluation
- **Input:** Current codebase state
- **Output:** Quality gate status, issues list (severity, file, line, rule)
- **Note:** Not an AI role, but follows the same BaseRole lifecycle for pipeline uniformity

### 6. Reviewer
- **Type:** AI
- **Responsibility:** Review code changes against task requirements and quality standards
- **Input:** Diff, task context, review rules
- **Output:** Review result (approved/rejected, blocking issues, suggestions, confidence)
- **Constraints:** Must output strict JSON schema

### 7. Tester (Quality Gate)
- **Type:** AI
- **Responsibility:** Judge quality of tests written by Coder
- **Input:** Test files, coverage report, Sonar test-related issues
- **Output:** Test quality verdict (coverage met, missing scenarios, test issues to fix)
- **Does NOT:** Write tests (that's Coder's job with TDD)
- **Does:** Run tests, verify coverage thresholds, identify untested edge cases, fix test quality issues from Sonar

### 8. Security
- **Type:** AI
- **Responsibility:** Audit code for security vulnerabilities before commit
- **Input:** Diff of changes
- **Output:** Security report (vulnerabilities found, severity, file, line, fix suggestion)
- **Checks:** OWASP top 10, exposed secrets/API keys, injection vectors, XSS, insecure dependencies

### 9. Commiter
- **Type:** AI + tool
- **Responsibility:** Git operations - commits, push, PRs, comments
- **Input:** Approved code changes, task context
- **Output:** Commit hash, PR URL, branch info
- **Constraints:** Conventional Commits, no AI references, atomic commits, < 70 char first line

### 10. Solomon (Conflict Resolver)
- **Type:** AI
- **Responsibility:** Resolve disagreements between roles (mainly Coder vs Reviewer)
- **Input:** Full history of feedback exchange between conflicting roles
- **Output:** Ruling (who is right, partial agreement, or escalate to human)
- **Rules:** Security > functionality > style. Green tests are sacred. Style preferences don't block.
- **Activates:** When iteration limit between two roles is reached

## Lifecycle (BaseRole Contract)

Every role implements the `BaseRole` interface:

```
class BaseRole {
  constructor(config, logger)

  // Load role instructions from .md file + initialize state
  async init(context: RoleContext): void

  // Execute the role's main task
  async execute(input: RoleInput): RoleOutput

  // Generate summary report of what was done
  report(): RoleReport

  // Optional: validate own output before passing to next role
  validate(output: RoleOutput): ValidationResult
}
```

### RoleContext (shared state)
```
{
  task: string,              // Original task description
  sessionId: string,         // Session identifier
  config: object,            // Karajan config
  research: object | null,   // Researcher output (if ran)
  plan: object | null,       // Planner output (if ran)
  previousFeedback: string,  // Accumulated feedback from prior iterations
  sonarSummary: string,      // Latest Sonar results
  iteration: number,         // Current iteration in the loop
  history: RoleOutput[]      // Outputs from all previous role executions
}
```

### RoleOutput
```
{
  role: string,              // Role name
  ok: boolean,               // Success/failure
  result: object,            // Role-specific result data
  summary: string,           // Human-readable summary
  timestamp: string          // ISO timestamp
}
```

### Events
Every role emits standard events via the shared EventEmitter:
- `role:start` — { role, iteration, context }
- `role:end` — { role, iteration, output }
- `role:error` — { role, iteration, error }

## Pipeline

### Default pipeline (full)
```
Karajan receives task
  → Researcher (optional, configurable)
  → Planner (optional, for complex tasks)
  → LOOP (max N iterations, configurable):
      → Coder
      → Sonar (if enabled)
      → Reviewer
      → IF rejected AND iteration < limit: continue loop
      → IF rejected AND iteration >= limit: → Solomon
  → Tester (quality gate)
  → Security (audit)
  → Commiter (git ops)
  → Karajan reports result to human
```

### Configurable sub-loops
```yaml
# kj.config.yml
pipeline:
  researcher: { enabled: auto }     # auto | always | never
  planner: { enabled: auto }        # auto for devPoints >= 3
  tester: { enabled: true }
  security: { enabled: true }
  commiter: { enabled: true }

loops:
  coder_sonar:
    max_iterations: 3               # Max coder ↔ sonar cycles
  coder_reviewer:
    max_iterations: 3               # Max coder ↔ reviewer cycles
  solomon_threshold: 3              # After this many total rejections, activate Solomon
```

### Solomon resolution rules
When activated, Solomon:
1. Receives: all reviewer feedback, all coder attempts, task requirements
2. Classifies each blocking issue as:
   - **Critical** (security, correctness, tests broken) → must fix
   - **Important** (architecture, maintainability) → should fix
   - **Style** (naming, formatting, preferences) → dismiss
3. Decision options:
   - Approve with conditions (list specific fixes)
   - Send specific instructions to Coder (not generic "fix issues")
   - Escalate to human (if conflicting requirements or ambiguous acceptance criteria)

## Role .md Files

Each role has an instruction file loaded as system prompt context:

```
templates/roles/
  researcher.md
  planner.md
  coder.md
  reviewer.md
  tester.md
  security.md
  commiter.md
  solomon.md
  karajan.md
```

Users can override per-project in `~/.karajan/roles/` or `$PROJECT/.karajan/roles/`.

Resolution order:
1. `$PROJECT/.karajan/roles/{role}.md` (project-specific)
2. `~/.karajan/roles/{role}.md` (user global)
3. `templates/roles/{role}.md` (built-in default)

## Consequences

### Positive
- Clear separation of concerns per role
- Each role is independently testable
- Easy to add new roles without modifying the orchestrator
- Solomon prevents infinite loops and deadlocks
- Role .md files allow customization without code changes

### Negative
- More files and abstractions to maintain
- Refactoring existing coder/reviewer requires careful migration
- Solomon adds an extra AI call when conflicts arise (cost)

### Risks
- Over-engineering if most tasks only need coder → reviewer
- Solomon's judgment depends on good rules in solomon.md
- Multiple AI calls per task increase latency and cost

### Mitigations
- Pipeline stages are all optional/configurable
- Simple tasks can skip Researcher, Planner, Tester, Security
- Solomon only activates when iteration limits are hit
- Cost tracking (future: budget role) to monitor spend
