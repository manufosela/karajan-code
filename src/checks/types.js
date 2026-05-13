/**
 * Shared check schema for doctor/preflight subsystem.
 *
 * A Check describes an environment requirement (binary present, port free,
 * token configured, MCP reachable...). Each check can optionally remediate
 * itself when it fails, using one of 4 strategies:
 *
 *   - "auto"   → fix without asking. Use for non-invasive, reversible changes
 *                (in-memory runtime overrides, starting existing services,
 *                creating files under ~/.karajan/, etc.)
 *   - "prompt" → ask user before fixing. Use for invasive changes that touch
 *                the user's system outside Karajan's scope (global npm install,
 *                writing kj.config.yml, `gh auth login`, etc.)
 *   - "manual" → cannot auto-fix, only report a hint (Node runtime upgrade,
 *                missing Docker, missing API key with no admin creds)
 *   - "none"   → informational check, always OK (Karajan version, feature
 *                disabled by config)
 */

/**
 * @typedef {Object} CheckResult
 * @property {boolean} ok                        - true if check passes
 * @property {"fail"|"warn"|"info"} [severity]   - relevant when !ok; default "fail"
 * @property {string} detail                     - human-readable status
 * @property {string} [fix]                      - remediation hint shown when manual or user declines
 * @property {Object} [extra]                    - structured data consumed by remediate (e.g. occupant PID, host, roles)
 */

/**
 * @typedef {Object} RemediationContext
 * @property {Object} config                     - resolved Karajan config
 * @property {AbortSignal} [signal]              - cancellation
 * @property {Object} extra                      - check's CheckResult.extra
 * @property {Object} logger                     - logger instance
 */

/**
 * @typedef {Object} RemediationResult
 * @property {boolean} fixed                     - true if remediation succeeded
 * @property {string} detail                     - what was done, human-readable
 * @property {Object} [changes]                  - runtime config overrides to merge into the active session
 */

/**
 * @typedef {Object} DegradableSpec
 * @property {string[]} disables        - dot-paths del config a desactivar si el check falla (e.g. ["git.auto_pr", "git.auto_push"])
 * @property {string} warn              - mensaje WARN que se muestra al usuario explicando qué se desactivó y por qué
 */

/**
 * @typedef {Object} Check
 * @property {string} name                       - slug, unique across all checks (e.g. "node-version")
 * @property {string} label                      - human label (e.g. "Node.js runtime")
 * @property {"auto"|"prompt"|"manual"|"none"} strategy
 * @property {(ctx: { config: Object }) => Promise<CheckResult>} detect
 * @property {(ctx: RemediationContext) => Promise<RemediationResult>} [remediate]
 * @property {string} [describe]                 - shown to user when strategy is "prompt"
 * @property {(config: Object) => boolean} [applies]  - if false, check is SKIPPED (lazy evaluation). Default: always applies.
 * @property {DegradableSpec} [degradable]       - KJC-BUG-0049: si está definido y el check falla, en lugar de abortar
 *                                                  el preflight, se desactivan los flags listados en `disables` y se emite
 *                                                  WARN con `warn`. Útil para features opcionales (auto_pr, auto_push,
 *                                                  sonar advisory, etc.) que no son blockers absolutos.
 */

/**
 * @typedef {Object} CheckReport
 * @property {string} name
 * @property {string} label
 * @property {"OK"|"FIXED"|"WARN"|"FAIL"|"SKIPPED"|"TIMEOUT"} status
 * @property {"auto"|"prompt"|"manual"|"none"} strategy
 * @property {string} detail                     - detect detail or remediate detail when FIXED
 * @property {string} [fix]                      - remediation hint for FAIL/WARN
 * @property {number} runMs                      - total time (detect + remediate + re-verify)
 * @property {boolean} [cached]                  - future: served from cache
 */

/**
 * @typedef {Object} RunReport
 * @property {CheckReport[]} checks
 * @property {Object} overrides                  - merged runtime overrides from auto-remediations
 * @property {number} totalMs
 * @property {{ ok: number, fixed: number, warn: number, fail: number, skipped: number, timeout: number }} summary
 */

/**
 * Status constants.
 */
export const STATUS = Object.freeze({
  OK: "OK",
  FIXED: "FIXED",
  WARN: "WARN",
  FAIL: "FAIL",
  SKIPPED: "SKIPPED",
  TIMEOUT: "TIMEOUT",
});

export const STRATEGY = Object.freeze({
  AUTO: "auto",
  PROMPT: "prompt",
  MANUAL: "manual",
  NONE: "none",
});

