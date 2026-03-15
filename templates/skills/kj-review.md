# kj-review — Code Review with Quality Gates

Review the current changes against task requirements and quality standards.

## Your task

Review the changes in the current branch: $ARGUMENTS

## Steps

1. Run `git diff main...HEAD` (or appropriate base branch) to see all changes
2. Review each changed file against the priorities below
3. Report findings clearly

## Review priorities (in order)

1. **Security** — vulnerabilities, exposed secrets, injection vectors
2. **Correctness** — logic errors, edge cases, broken tests
3. **Tests** — adequate coverage, meaningful assertions
4. **Architecture** — patterns, maintainability, SOLID principles
5. **Style** — naming, formatting (only flag if egregious)

## Scope constraint

- **ONLY review files present in the diff** — do not flag issues in untouched files
- Out-of-scope issues go as suggestions, never as blocking

## Guardrails (auto-check)

Flag as BLOCKING if any of these are detected in the diff:
- [ ] Hardcoded credentials, API keys, or secrets
- [ ] Entire file replaced (massive deletions + additions instead of targeted edits)
- [ ] `eval()`, `innerHTML` with user input, SQL string concatenation
- [ ] Missing test changes when source files changed (TDD violation)
- [ ] `rm -rf`, `DROP TABLE`, `git push --force` or similar destructive operations

## Output

For each issue found:
- **File and line** where the issue is
- **Severity**: critical / major / minor
- **Description**: what's wrong
- **Suggested fix**: how to fix it

End with a clear verdict:
- **APPROVED** — no blocking issues found
- **REQUEST_CHANGES** — blocking issues listed above must be fixed
