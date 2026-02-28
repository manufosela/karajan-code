# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in karajan-code, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. Email **mjfosela@gmail.com** with the subject line: `[SECURITY] karajan-code vulnerability report`
2. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment** within 48 hours
- **Assessment** within 7 days
- **Fix or mitigation** within 30 days for confirmed vulnerabilities
- Credit in the release notes (unless you prefer anonymity)

### Scope

The following are in scope:
- Command injection via task descriptions or config values
- Arbitrary file read/write outside the project directory
- Credential leakage (API keys, tokens) in logs or reports
- MCP server vulnerabilities (unauthorized tool execution)

The following are out of scope:
- Vulnerabilities in third-party AI CLIs (claude, codex, gemini, aider)
- SonarQube Docker container security (report to SonarSource)
- Denial of service via resource exhaustion (long-running tasks)
