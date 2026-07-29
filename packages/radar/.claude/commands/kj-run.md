# kj-run — Full Pipeline (Skills Mode)

Execute the complete Karajan pipeline as sequential skills.

## Your task

$ARGUMENTS

## Pipeline steps (execute in order)

### Step 1 — Discover (optional but recommended)
Analyze the task for gaps before coding:
- Identify missing requirements, ambiguities, contradictions
- If critical gaps found, STOP and ask the user before proceeding
- If ready, continue

### Step 2 — Code (with guardrails)
Implement the task:
1. **Tests first** (TDD): write/update tests before implementation
2. **Implement**: minimal, focused code to fulfill the task
3. **Verify**: run the test suite
4. **Security check**: no hardcoded secrets, no injection vectors, no destructive ops in the diff
5. **Diff check**: run `git diff` and verify only intended lines changed
6. If any guardrail fails, fix before proceeding

### Step 3 — Review (self-review)
Review your own changes against quality standards:
1. Run `git diff main...HEAD` (or base branch)
2. Check: security, correctness, tests, architecture, style (in that order)
3. Flag blocking issues:
   - Hardcoded credentials or secrets
   - Entire files overwritten instead of targeted edits
   - Missing tests for new code
   - SQL injection, XSS, command injection
   - Destructive operations
4. If blocking issues found, fix them and re-review
5. If clean, proceed

### Step 4 — Test audit
Verify test quality:
1. Every changed source file has corresponding tests
2. Run `npm test` (or equivalent) — all must pass
3. No skipped tests for changed code
4. If tests fail, fix before proceeding

### Step 5 — Security scan
Quick security audit on the diff:
1. Scan for OWASP top 10 in changed files
2. Check for leaked secrets, injection vectors, missing auth
3. If critical/high findings, fix before proceeding

### Step 6 — Sonar (if available)
If SonarQube is running (`docker ps | grep sonarqube`):
1. Run `npx @sonar/scan`
2. Check quality gate
3. Fix blockers and critical issues

### Step 7 — Commit
If all steps pass:
1. Stage changed files: `git add <specific files>`
2. Commit with conventional commit message: `feat:`, `fix:`, `refactor:`, etc.
3. Do NOT push unless the user explicitly asks

## HU Board Integration
If HU Board is enabled (`hu_board.enabled: true` in config), stories and sessions
are automatically tracked and visible at the board URL. Run `kj board` to start it.

## Important rules

- **Never skip steps** — execute all applicable steps in order
- **Fix before proceeding** — if a step finds issues, fix them before moving to the next
- **Report progress** — after each step, briefly state what was done and the result
- **Stop on critical** — if a critical security or correctness issue can't be fixed, stop and report
