# kj-security — Security Audit

Perform a security audit on the current changes.

## Your task

$ARGUMENTS

## Steps

1. Run `git diff main...HEAD` to see all changes
2. Scan for each vulnerability category below
3. Report findings with severity and remediation

## Vulnerability categories

### Critical
- [ ] Hardcoded secrets (API keys, passwords, tokens, connection strings)
- [ ] SQL injection (string concatenation in queries)
- [ ] Command injection (`exec`, `spawn` with unsanitized input)
- [ ] Path traversal (file operations with user-controlled paths)

### High
- [ ] XSS (Cross-Site Scripting) — `innerHTML`, `dangerouslySetInnerHTML` with user input
- [ ] Missing authentication/authorization checks on new endpoints
- [ ] Insecure deserialization
- [ ] SSRF (Server-Side Request Forgery) — fetch/request with user-controlled URLs

### Medium
- [ ] Missing input validation at system boundaries
- [ ] Verbose error messages that leak internal details
- [ ] Missing CSRF protection on state-changing endpoints
- [ ] Insecure random number generation for security purposes

### Low
- [ ] Missing security headers
- [ ] Dependencies with known vulnerabilities (check `npm audit`)
- [ ] Console.log with sensitive data

## Output

For each finding:
- **Severity**: critical / high / medium / low
- **File and line**: where the issue is
- **Category**: which vulnerability type
- **Description**: what's wrong
- **Remediation**: specific fix

End with a summary: total findings by severity, and whether the code is safe to ship.
