# Audit false positives — verified non-removable dependencies

> Living document. When a `kj audit` run flags a dependency as unused but
> manual verification confirms it IS used (typically via config files,
> hooks, or scripts not imported as JS modules), append an entry below.
> Doing this prevents future audits from re-opening the same investigation.

## Why this exists

`kj audit` (and the underlying `knip` heuristic) detects dependencies
that are not statically imported anywhere in the codebase. This catches
real dead weight, but produces false positives for tools that integrate
through indirect means:

- **Build/test config files** referenced by name (e.g. a Vitest
  `provider: "v8"` referencing `@vitest/coverage-v8`).
- **Git hooks** installed once into `.git/hooks/` by the package itself
  (e.g. `simple-git-hooks`).
- **Scripts on disk** invoked via `npx` from shell scripts or CI
  workflows (e.g. `postject` invoked by `scripts/build-sea.mjs`).
- **External infrastructure** with config in dot-folders (e.g.
  `@changesets/cli` driven by `.changeset/config.json`).

If you remove one of these, the corresponding workflow breaks even
though no JS test fails. Hence: verify before removing.

## Verified false positives (2026-05-04)

Audit run: `kj audit` on 2026-05-03 (PR #577 / KJC-TSK-0352 epoch).
Investigation tracked in KJC-TSK-0353 / GH issue #574.

| Dependency | Verdict | Evidence |
| --- | --- | --- |
| `@changesets/cli` | **Keep** | `.changeset/config.json` references `@changesets/cli/changelog`. PR #360 (Jorge del Casar) is in flight against changesets infra. |
| `@vitest/coverage-v8` | **Keep** | `vitest.config.js` declares `coverage.provider = "v8"`. Activated when running `npx vitest run --coverage`. |
| `postject` | **Keep** | `scripts/build-sea.mjs` invokes `npx postject` to inject the SEA blob into the binary. Workflow `release-binaries.yml` depends on this for every release. |
| `simple-git-hooks` | **Keep** | Hook installed at `.git/hooks/pre-commit` (runs `npx lint-staged`). Config block in `package.json` under `"simple-git-hooks"`. |

## Process for future audits

1. Run `kj audit` and read the `unusedDependencies.unused` list.
2. For each candidate, before opening a removal PR, grep the entire
   repo: `grep -rn "<dep-name>" package.json scripts/ .github/ docs/`.
3. If any indirect usage is found, append an entry to the table above
   instead of removing the dependency.
4. Only `npm uninstall` after all four verification paths come back
   empty (JS imports, config files, scripts, hooks).

## Deterministic FP filter (v2.16+)

In addition to this manual log, `kj audit` runs a deterministic filter
on every collector's findings BEFORE they reach the LLM or the user.
Source: `src/audit/issue-filter.js`. Two complementary mechanisms:

### 1. Static rules in `config.audit.false_positives`

Shape: `{ tool, rule, filePattern, reason }`. Example in a project's
`karajan.config.json`:

```jsonc
{
  "audit": {
    "false_positives": [
      {
        "tool": "knip",
        "rule": "unused-exports",
        "filePattern": "src/api/public/",
        "reason": "Public API surface for downstream consumers"
      },
      {
        "tool": "madge",
        "rule": "circular-import",
        "filePattern": "src/legacy/",
        "reason": "Known legacy module cluster — tracked in EPIC-XYZ"
      },
      {
        "tool": "sonar",
        "rule": "javascript:S6840",
        "filePattern": "tests/fixtures/",
        "reason": "Test fixture deliberately uses anti-pattern under test"
      }
    ]
  }
}
```

The legacy `config.sonar.false_positives` keeps working (entries are
treated as if they had `tool: "sonar"`).

### 2. Inline ignore markers

Drop a marker on the issue line (or the line above):

```js
const userInput = req.query.q; // karajan-audit-ignore: semgrep:javascript.express.security.audit.xss.direct-response-write
```

The legacy `// karajan-sonar-ignore: <ruleId>` marker keeps working for
sonar issues only.

### Built-in catalogue

`src/audit/issue-filter.js` ships a small catalogue of patterns that
ship as filtered by default — currently:

| Tool | Rule | File pattern | Reason |
| --- | --- | --- | --- |
| sonar | `javascript:S2699` | `tests/architecture/` | Architectural tests assert via `expect(off, msg).toEqual([])` and Sonar misses the custom-message form |

Suppressed findings remain accessible in the `suppressed` field of each
collector's result for auditability.

## Structural collectors (v2.17+)

`kj audit` runs four deterministic collectors before the LLM phase
(KJC-TSK v2.17). Each is stack-aware and degrades cleanly when its
prerequisites are missing:

| Collector | Source | Dimension | Stack | Skips if |
| --- | --- | --- | --- | --- |
| Sonar | `src/audit/sonar-findings.js` | mixed | any | Sonar host unreachable |
| OSV | `src/audit/osv-findings.js` | security | any | `osv-scanner` binary missing |
| Semgrep | `src/audit/semgrep-findings.js` | security | any | `semgrep` binary missing |
| Madge circular-deps | `src/audit/circular-deps.js` | architecture | JS/TS only | No JS/TS sources, no `src/` |
| Knip dead-exports | `src/audit/dead-exports.js` | codeQuality | JS/TS only | No `package.json`, no JS/TS |

All five flow through the FP filter above. CLI flags `--no-sonar`,
`--no-osv`, `--no-semgrep`, `--no-madge`, `--no-knip` disable each one
independently. `--deterministic-only` runs the collectors but skips the
LLM phase entirely (zero tokens).
