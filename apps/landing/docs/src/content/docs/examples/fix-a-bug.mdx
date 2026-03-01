---
title: Examples
description: Real-world workflow examples with Karajan Code.
---

import { Tabs, TabItem } from '@astrojs/starlight/components';

## Fix a bug

Full pipeline with security audit enabled:

<Tabs>
<TabItem label="CLI">

```bash
kj run "Fix SQL injection in search endpoint - parameterize the query" \
  --mode strict \
  --enable-security \
  --auto-commit
```

</TabItem>
<TabItem label="MCP">

```json
{
  "tool": "kj_run",
  "params": {
    "task": "Fix SQL injection in search endpoint - parameterize the query",
    "mode": "strict",
    "enableSecurity": true,
    "autoCommit": true
  }
}
```

</TabItem>
</Tabs>

**Expected output:**

```
[coder]    Replacing string interpolation with parameterized query...
[sonar]    Quality gate passed — 0 blockers, 0 critical
[security] 0 vulnerabilities found — pass
[reviewer] APPROVED — no issues found (confidence: 0.98)
✔ Pipeline completed in 1m 42s (iteration 1/5)

Commits:
  fix: parameterize search query to prevent SQL injection
```

---

## Add a feature with TDD

Enable the planner for complex features:

<Tabs>
<TabItem label="CLI">

```bash
kj run "Implement user avatar upload with size validation and CDN integration" \
  --methodology tdd \
  --enable-planner \
  --enable-refactorer \
  --max-iterations 4
```

</TabItem>
<TabItem label="MCP">

```json
{
  "tool": "kj_run",
  "params": {
    "task": "Implement user avatar upload with size validation and CDN integration",
    "methodology": "tdd",
    "enablePlanner": true,
    "enableRefactorer": true,
    "maxIterations": 4
  }
}
```

</TabItem>
</Tabs>

**Expected output:**

```
[planner]    Plan: 3 phases — test fixtures, handler implementation, CDN integration
[coder]      Writing tests first, then implementation...
[refactorer] Extracted validateImageSize() utility
[sonar]      Quality gate passed — coverage 94%
[reviewer]   APPROVED — clean implementation (confidence: 0.96)
✔ Pipeline completed in 2m 34s (iteration 1/4)

Commits:
  test: add avatar upload handler test suite
  feat: implement avatar upload with validation
  refactor: extract image validation utility
```

---

## Security audit

Review existing code for OWASP vulnerabilities:

<Tabs>
<TabItem label="CLI">

```bash
kj run "Security audit of src/auth/ — check for OWASP top 10" \
  --enable-security \
  --mode paranoid \
  --base-ref HEAD~10
```

</TabItem>
<TabItem label="MCP">

```json
{
  "tool": "kj_run",
  "params": {
    "task": "Security audit of src/auth/ — check for OWASP top 10",
    "enableSecurity": true,
    "mode": "paranoid",
    "baseRef": "HEAD~10"
  }
}
```

</TabItem>
</Tabs>

**Expected output:**

```
[security]  3 vulnerabilities found:
            CRITICAL — JWT secret hardcoded (src/auth/jwt.js:28)
            HIGH     — Email not validated before query (src/auth/login.js:42)
            MEDIUM   — Password hash in debug logs (src/auth/session.js:15)
[coder]     Fixing 3 vulnerabilities...
[reviewer]  APPROVED — all fixes verified (confidence: 0.99)
✔ Pipeline completed in 1m 45s (iteration 1/5)
```

---

## Quick change (no review)

Skip the review loop for simple changes:

<Tabs>
<TabItem label="CLI">

```bash
kj code "Add a loading spinner to the dashboard component"
```

</TabItem>
<TabItem label="MCP">

```json
{
  "tool": "kj_code",
  "params": {
    "task": "Add a loading spinner to the dashboard component"
  }
}
```

</TabItem>
</Tabs>

No reviewer, no SonarQube, no loop. The coder writes code and you review it yourself.

---

## Review existing changes

Review your manual changes without writing code:

<Tabs>
<TabItem label="CLI">

```bash
kj review "Check my authentication refactor for security issues" \
  --mode paranoid
```

</TabItem>
<TabItem label="MCP">

```json
{
  "tool": "kj_review",
  "params": {
    "task": "Check my authentication refactor for security issues",
    "mode": "paranoid"
  }
}
```

</TabItem>
</Tabs>

**Expected output:**

```
Reviewing diff from main..HEAD (12 commits, 340 lines)

REJECTED — 2 blocking issues:
  B1: Session token not invalidated on logout (src/auth/session.js:58)
  B2: Missing input validation for token claims (src/auth/jwt.js:22)

Suggestions:
  S1: Use crypto.timingSafeEqual() for password comparison

Confidence: 0.92
```

---

## Multi-agent workflow

Use a fast coder with a strict reviewer:

<Tabs>
<TabItem label="CLI">

```bash
kj run "Implement caching layer for database queries" \
  --coder codex \
  --reviewer claude \
  --reviewer-fallback claude \
  --mode paranoid \
  --max-iterations 6
```

</TabItem>
<TabItem label="MCP">

```json
{
  "tool": "kj_run",
  "params": {
    "task": "Implement caching layer for database queries",
    "coder": "codex",
    "reviewer": "claude",
    "reviewerFallback": "claude",
    "mode": "paranoid",
    "maxIterations": 6
  }
}
```

</TabItem>
</Tabs>

**Expected flow:**

```
Iteration 1: codex writes → claude rejects (2 issues)
Iteration 2: codex fixes  → claude rejects (1 issue)
Iteration 3: codex fixes  → claude APPROVES ✓

Total: 3m 27s | Cost: $1.42
```

---

## Budget-controlled execution

Set spending limits to prevent runaway costs:

<Tabs>
<TabItem label="CLI">

```bash
kj run "Add multi-language support to UI components" \
  --max-iterations 3 \
  --max-iteration-minutes 8 \
  --max-total-minutes 60
```

</TabItem>
<TabItem label="MCP">

```json
{
  "tool": "kj_run",
  "params": {
    "task": "Add multi-language support to UI components",
    "maxIterations": 3,
    "maxIterationMinutes": 8,
    "maxTotalMinutes": 60
  }
}
```

</TabItem>
</Tabs>

Add a hard budget cap in config:

```yaml
# ~/.karajan/kj.config.yml
max_budget_usd: 2.00
budget:
  warn_threshold_pct: 80
```

Check costs after the run:

```bash
kj report --trace --currency eur
```

```
Stage    | Role     | Duration | Cost (EUR)
---------|----------|----------|----------
1        | coder    | 45.2s    | €0.48
2        | reviewer | 14.8s    | €0.28
3        | coder    | 32.1s    | €0.39
4        | reviewer | 12.4s    | €0.20
---------|----------|----------|----------
Total               | 1m 44s   | €1.35
```

---

## Paranoid mode for critical systems

Maximum rigor for payment, auth, or compliance-critical code:

<Tabs>
<TabItem label="CLI">

```bash
kj run "Implement PCI-DSS compliant payment processor" \
  --coder claude \
  --reviewer claude \
  --mode paranoid \
  --enable-security \
  --enable-tester \
  --enable-refactorer \
  --max-iterations 10
```

</TabItem>
<TabItem label="MCP">

```json
{
  "tool": "kj_run",
  "params": {
    "task": "Implement PCI-DSS compliant payment processor",
    "coder": "claude",
    "reviewer": "claude",
    "mode": "paranoid",
    "enableSecurity": true,
    "enableTester": true,
    "enableRefactorer": true,
    "maxIterations": 10
  }
}
```

</TabItem>
</Tabs>

In paranoid mode, the reviewer defaults to **rejection** and only approves with confidence > 0.85. Expect more iterations but higher quality:

```
Iteration 1: REJECTED — missing rate limiter
Iteration 2: REJECTED — error leaks card number
Iteration 3: APPROVED ✓ (confidence: 0.98)

Security audit: 0 vulnerabilities
Test coverage: 97%
SonarQube: PASSED (0 bugs, 0 smells)
```

---

## Planning Game integration

Execute tasks from your project management board:

<Tabs>
<TabItem label="CLI">

```bash
kj run "KJC-TSK-0042" \
  --pg-project "My Project" \
  --pg-task KJC-TSK-0042 \
  --auto-commit \
  --auto-push
```

</TabItem>
<TabItem label="MCP">

```json
{
  "tool": "kj_run",
  "params": {
    "task": "KJC-TSK-0042",
    "pgTask": "KJC-TSK-0042",
    "pgProject": "My Project",
    "autoCommit": true,
    "autoPush": true
  }
}
```

</TabItem>
</Tabs>

Karajan fetches the full task context (description, acceptance criteria) from Planning Game and updates the card status on completion.

---

## Generate an implementation plan

Plan before coding — useful for complex tasks:

<Tabs>
<TabItem label="CLI">

```bash
kj plan "Migrate authentication from sessions to JWT"
```

</TabItem>
<TabItem label="MCP">

```json
{
  "tool": "kj_plan",
  "params": {
    "task": "Migrate authentication from sessions to JWT"
  }
}
```

</TabItem>
</Tabs>

Returns a structured plan with phases, risks, and estimated effort — without writing any code.

---

## Dry run

Preview what would happen without executing:

```bash
kj run "Refactor database layer" --dry-run
```

Shows which agents would run, estimated duration, and cost — without making any changes.
