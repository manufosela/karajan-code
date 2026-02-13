# Karajan Code

Local CLI to orchestrate two coding agents with SonarQube and an automated review loop.

## Quick start

```bash
npm install
npm link
kj init
kj doctor
kj run "Implement authentication flow"
```

## Commands

- `kj init`
- `kj run <task>`
- `kj code <task>`
- `kj review <task>`
- `kj scan`
- `kj doctor`
- `kj report [--list]`
- `kj resume <session-id>`
- `kj sonar status|start|stop|logs`

## Notes

- Default mode is `standard` (critical/important focus).
- Set `review_mode: paranoid` and `sonarqube.enforcement_profile: paranoid` for strict gate compliance.
- Use env vars for secrets (`KJ_SONAR_TOKEN`, provider keys).
