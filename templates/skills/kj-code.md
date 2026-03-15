# kj-code — Coder with Guardrails

Implement the task with TDD methodology and built-in quality checks.

## Your task

$ARGUMENTS

## Methodology

1. **Tests first**: Write or update tests BEFORE implementation
2. **Implement**: Write minimal, focused code to pass the tests
3. **Verify**: Run the test suite (`npm test` or project equivalent)
4. **Check diff**: Run `git diff` and verify ONLY intended lines changed

## Guardrails (MANDATORY)

After writing code, verify ALL of these before reporting done:

### Security check
- [ ] No hardcoded credentials, API keys, or secrets in the diff
- [ ] No `eval()`, `innerHTML` with user input, or SQL string concatenation
- [ ] User input is validated/sanitized at system boundaries

### Destructive operation check
- [ ] No `rm -rf /`, `DROP TABLE`, `git push --force`, or similar in the diff
- [ ] No `fs.rmSync` or `fs.rm` on paths derived from user input
- [ ] No `process.exit()` in library code

### Performance check
- [ ] No synchronous file I/O (`readFileSync`, `writeFileSync`) in request handlers
- [ ] No `document.write()` or layout thrashing patterns
- [ ] No unbounded loops or missing pagination

### TDD check
- [ ] Source changes have corresponding test changes
- [ ] Tests actually run and pass

## File modification safety

- NEVER overwrite existing files entirely — make targeted edits
- After each edit, verify with `git diff` that ONLY intended lines changed
- If unintended changes detected, revert immediately with `git checkout -- <file>`

## Completeness check

Before reporting done:
- Re-read the task description
- Check every requirement is addressed
- Run the test suite
- Verify no regressions
