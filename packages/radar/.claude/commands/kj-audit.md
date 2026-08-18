# kj-audit — Codebase Health Audit

Analyze the current codebase for security, code quality, performance, architecture, and testing issues. This is a READ-ONLY analysis — do not modify any files.

## Your task

$ARGUMENTS

## Dimensions to analyze

### 1. Security
- Hardcoded secrets, API keys, tokens in source code
- SQL/NoSQL injection vectors (string concatenation in queries)
- XSS vulnerabilities (innerHTML, dangerouslySetInnerHTML, eval)
- Command injection (exec, spawn with user input)
- Insecure dependencies (check package.json for known vulnerable packages)
- Missing input validation at system boundaries
- Authentication/authorization gaps

### 2. Code Quality (SOLID, DRY, KISS, YAGNI)
- Functions/methods longer than 50 lines
- Files longer than 500 lines
- Duplicated code blocks (same logic in multiple places)
- God classes/modules (too many responsibilities)
- Deep nesting (>4 levels)
- Dead code (unused exports, unreachable branches)
- Missing error handling (uncaught promises, empty catches)
- Over-engineering (abstractions for single use)

### 3. Performance
- N+1 query patterns
- Synchronous file I/O in request handlers
- Missing pagination on list endpoints
- Large bundle imports (importing entire libraries for one function)
- Missing lazy loading
- Expensive operations in loops
- Missing caching opportunities

### 4. Architecture
- Circular dependencies
- Layer violations (UI importing from data layer directly)
- Coupling between modules (shared mutable state)
- Missing dependency injection
- Inconsistent patterns across the codebase
- Missing or outdated documentation
- Configuration scattered vs centralized

### 5. Testing
- Test coverage gaps (source files without corresponding tests)
- Test quality (assertions per test, meaningful test names)
- Missing edge case coverage
- Test isolation (shared state between tests)
- Flaky test indicators (timeouts, sleep, retries)

## Output

For each dimension, provide:
- **Score**: A (excellent) to F (failing)
- **Findings**: severity, file, line, rule, description, recommendation

End with:
- **Overall Health**: good / fair / poor / critical
- **Top Recommendations**: prioritized list of actions with impact and effort estimates
