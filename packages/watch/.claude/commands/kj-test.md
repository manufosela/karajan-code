# kj-test — Test Quality Audit

Evaluate test coverage and quality for the current changes.

## Your task

$ARGUMENTS

## Steps

1. Run `git diff main...HEAD` to identify changed source files
2. For each changed source file, find the corresponding test file
3. Run the test suite and check results
4. Evaluate test quality

## Checks

### Coverage
- [ ] Every changed source file has a corresponding test file
- [ ] New functions/methods have at least one test
- [ ] Edge cases are covered (null, empty, boundary values)

### Quality
- [ ] Tests have meaningful assertions (not just "no error thrown")
- [ ] Test descriptions clearly state what is being tested
- [ ] No tests that always pass (e.g., empty test body, `expect(true).toBe(true)`)
- [ ] Mocks are minimal — prefer real implementations where feasible

### Execution
- [ ] Run `npm test` (or project equivalent) and report results
- [ ] All tests pass
- [ ] No skipped tests (`.skip`) for the changed code

## Output

Report:
- Test files found/missing for each changed source file
- Test execution results (pass/fail count)
- Quality issues found
- Suggestions for improving coverage
