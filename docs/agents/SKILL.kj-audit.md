# SKILL: kj audit

## What it does

Read-only analysis of a codebase. Surfaces god-functions, missing
imports (the bug class that took down a real demo on 2026-04-27),
oversized modules, structure smells, and (planned, see issue #542)
agent-readiness. Does NOT modify any file in the audited repo.

## Inputs

| Input | Form | Required |
|---|---|---|
| Path to repo | positional `[path]` (default: cwd) | optional |
| Output JSON | `--json` | optional |
| Limit dimensions | `--dimensions <a,b,c>` | optional |
| Verbose | `--verbose` | optional |

Available dimensions (subject to issue #542 expansion):
`security`, `code-quality`, `performance`, `architecture`, `testing`.

## Outputs

- **stdout**: human report (per-dimension findings, severity, file:line, suggested fix).
- **stdout (`--json`)**: structured findings array, suitable for CI integration.
- **disk**: optional report under `~/.karajan/audits/<timestamp>/` if configured.
- **exit 0**: audit ran successfully (regardless of findings count).
- **exit non-zero**: tooling error (cannot read repo, missing dependency).

## Constraints

- Read-only on the audited repo. Will NEVER write into the path argument.
- Does NOT call an LLM by default. Pure static analysis + heuristics.
- Optional: `--with-llm` (planned) consults an LLM for severity ranking.
- Node ≥ 18.

## Side effects

None on the audited repo. Findings persisted to `~/.karajan/audits/` if `audits.persist: true` in config.

## Common failure modes

| Error | Cause | Fix |
|---|---|---|
| `Path not a directory` | Bad `[path]` arg | Verify the path |
| `No JS files found` | Wrong project root | Pass the real source root |
| `Permission denied` | File mode | Check fs permissions |

## Example

```bash
# Audit current dir
kj audit

# Audit another repo, JSON for CI
kj audit ~/ws/some-other-repo --json > audit.json

# Limit to one dimension
kj audit --dimensions architecture
```

## Related

- [SKILL.kj-plan.md](SKILL.kj-plan.md) — once you have findings, you can SPEC fixes and feed them to `kj plan generate`.
- Issue #542 — `--agent-readiness` dimension (third-party repo scoring).
