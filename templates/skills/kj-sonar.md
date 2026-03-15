# kj-sonar — Static Analysis

Run SonarQube/SonarCloud analysis and fix any issues found.

## Your task

$ARGUMENTS

## Steps

1. Check if SonarQube is running: `docker ps | grep sonarqube`
2. If running, execute scan:
   ```bash
   npx @sonar/scan -Dsonar.host.url=http://localhost:9000 -Dsonar.projectKey=<project-key>
   ```
3. Check quality gate status:
   ```bash
   curl -s -u admin:admin "http://localhost:9000/api/qualitygates/project_status?projectKey=<project-key>"
   ```
4. List issues:
   ```bash
   curl -s -u admin:admin "http://localhost:9000/api/issues/search?projectKeys=<project-key>&statuses=OPEN&ps=50"
   ```

## If SonarQube is not available

Perform manual static analysis checks:
- [ ] Cognitive complexity — functions over 15 should be refactored
- [ ] Duplicated code blocks (3+ lines repeated)
- [ ] Unused imports and variables
- [ ] Empty catch blocks without comments
- [ ] Nested ternary operations
- [ ] `console.log` left in production code

## Output

Report:
- Quality gate status (passed/failed)
- Issues found by severity (blocker, critical, major, minor)
- For each issue: file, line, rule, and suggested fix
- Fix critical and blocker issues before proceeding
