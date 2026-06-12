/**
 * Brain decisor — intent-driven pipeline routing.
 *
 * Takes the triage output + task text + config and produces a Decision that
 * the orchestrator applies as pipelineFlags overrides. The existing stage
 * if/else in runFlow continues to drive execution; Brain just tells it which
 * roles are relevant for this particular task.
 *
 * This is an MVP that keeps the current architecture. A future iteration
 * (Pipeline Sovereignty / KJC-PCS-0022) can promote the Decision into a
 * true DAG with parallel stage execution.
 */

/**
 * @typedef {Object} TriageOutput
 * @property {"trivial"|"simple"|"medium"|"complex"} level
 * @property {string[]} roles                       - roles triage suggests running
 * @property {string} [taskType]                    - sw | infra | doc | add-tests | refactor | no-code | audit
 * @property {string} [reasoning]
 * @property {number} [confidence]                  - 0..1, often absent
 * @property {string[]} [domainHints]
 */

/**
 * @typedef {Object} Decision
 * @property {string[]} rolesOn                     - roles to enable in pipelineFlags
 * @property {string[]} rolesOff                    - roles to explicitly disable
 * @property {"low"|"medium"|"high"} confidence
 * @property {string} rationale                     - human-readable reasoning
 * @property {boolean} consultSolomon               - true if the Brain is unsure
 * @property {string} [solomonReason]               - why Solomon is needed
 * @property {string[]} appliedOverrides            - names of manual overrides respected
 */

const VALID_ROLES = new Set([
  "planner", "researcher", "architect", "coder", "reviewer", "refactorer",
  "tester", "security", "impeccable", "triage", "discover", "hu_reviewer", "solomon",
]);

/**
 * Translate triage level → base set of roles. Conservative baseline that the
 * decisor then adjusts via taskType and domain hints.
 */
function baselineForLevel(level) {
  switch (level) {
    case "trivial": return new Set(["coder"]);
    case "simple": return new Set(["coder", "reviewer"]);
    case "medium": return new Set(["coder", "reviewer", "tester"]);
    case "complex": return new Set(["researcher", "architect", "planner", "coder", "reviewer", "tester", "security"]);
    default: return new Set(["coder", "reviewer"]);
  }
}

/**
 * Apply taskType adjustments on top of the baseline set (mutates in place).
 */
function applyTaskTypeAdjustments(roles, taskType) {
  switch (taskType) {
    case "doc":
      // Documentation tasks: skip testing and security, keep reviewer for tone/clarity.
      roles.delete("tester");
      roles.delete("security");
      roles.delete("refactorer");
      break;
    case "add-tests":
      // Adding tests: tester is primary, security less relevant.
      roles.add("tester");
      roles.delete("security");
      break;
    case "refactor":
      // Refactor: no new behavior; tester verifies nothing broke; reviewer checks structure.
      roles.add("refactorer");
      roles.add("tester");
      break;
    case "infra":
      // Infra: architect helps; security critical.
      roles.add("architect");
      roles.add("security");
      break;
    case "audit":
      // Audit: no coder; reviewer + security.
      roles.delete("coder");
      roles.add("reviewer");
      roles.add("security");
      break;
    case "no-code":
      // No-code tasks (e.g. running SQL queries): drop coder+reviewer+tester.
      roles.delete("coder");
      roles.delete("reviewer");
      roles.delete("tester");
      break;
  }
}

/**
 * Apply explicit overrides (CLI flags / config) on top of the decision.
 * force = add; skip = remove. Tracks what was applied.
 *
 * @param {Set<string>} roles
 * @param {{ forceRoles?: string[], skipRoles?: string[] }} overrides
 * @returns {string[]} applied override names
 */
function applyOverrides(roles, overrides) {
  const applied = [];
  for (const r of overrides.forceRoles || []) {
    if (!VALID_ROLES.has(r)) continue;
    roles.add(r);
    applied.push(`force:${r}`);
  }
  for (const r of overrides.skipRoles || []) {
    if (!VALID_ROLES.has(r)) continue;
    roles.delete(r);
    applied.push(`skip:${r}`);
  }
  return applied;
}

/**
 * Build a routing Decision from triage output + task text + config.
 *
 * @param {Object} args
 * @param {TriageOutput} args.triage
 * @param {string} [args.task]
 * @param {Object} [args.config]                   - resolved config (for rolesEnabled in pipeline)
 * @param {{ forceRoles?: string[], skipRoles?: string[] }} [args.overrides]
 * @returns {Decision}
 */
export function buildDecision({ triage, task: _task, config = {}, overrides = {} } = {}) {
  const level = triage?.level || "simple";
  const taskType = triage?.taskType || "sw";

  // 1. Baseline by complexity.
  const roles = baselineForLevel(level);

  // 2. Include triage's own suggested roles (triage already factors domain hints).
  if (Array.isArray(triage?.roles)) {
    for (const r of triage.roles) {
      if (VALID_ROLES.has(r)) roles.add(r);
    }
  }

  // 3. Task-type-specific adjustments.
  applyTaskTypeAdjustments(roles, taskType);

  // 4. Config pipeline.X.enabled=false forces a role off (respect user config).
  const pipeline = config?.pipeline || {};
  for (const r of Array.from(roles)) {
    if (pipeline[r]?.enabled === false) {
      roles.delete(r);
    }
  }

  // 5. Manual CLI/flag overrides (highest priority).
  const appliedOverrides = applyOverrides(roles, overrides);

  // 6. Invariants: coder is always on unless explicitly audit/no-code AND not force-added.
  if (taskType !== "audit" && taskType !== "no-code" && !overrides.skipRoles?.includes("coder")) {
    roles.add("coder");
  }

  // 7. Confidence + Solomon consultation.
  const explicitConfidence = typeof triage?.confidence === "number" ? triage.confidence : null;
  let confidence = "medium";
  let consultSolomon = false;
  let solomonReason;
  if (explicitConfidence !== null) {
    if (explicitConfidence < 0.6) {
      confidence = "low";
      consultSolomon = true;
      solomonReason = `triage confidence ${explicitConfidence.toFixed(2)} < 0.6`;
    } else if (explicitConfidence >= 0.85) {
      confidence = "high";
    }
  }
  // Ambiguous level (absent or off-vocabulary) → low confidence regardless.
  if (!triage?.level) {
    confidence = "low";
    consultSolomon = true;
    solomonReason = "triage returned no level";
  }

  const rolesOn = Array.from(roles).sort((a, b) => a.localeCompare(b));
  const rolesOff = Array.from(VALID_ROLES).filter((r) => !roles.has(r)).sort((a, b) => a.localeCompare(b));

  const rationale = buildRationale({ level, taskType, rolesOn, appliedOverrides, triage });

  return {
    rolesOn,
    rolesOff,
    confidence,
    rationale,
    consultSolomon,
    solomonReason,
    appliedOverrides,
  };
}

function buildRationale({ level, taskType, rolesOn, appliedOverrides, triage }) {
  const parts = [
    `level=${level}`,
    `taskType=${taskType}`,
    `roles=[${rolesOn.join(",")}]`,
  ];
  if (triage?.domainHints?.length) {
    parts.push(`hints=[${triage.domainHints.slice(0, 3).join(",")}]`);
  }
  if (appliedOverrides.length) {
    parts.push(`overrides=[${appliedOverrides.join(",")}]`);
  }
  return parts.join(" | ");
}

/**
 * Apply a Decision onto an existing pipelineFlags object. Returns a NEW
 * object — the input is not mutated. Setting roleEnabled flags via a
 * consistent naming pattern: `${role}Enabled`.
 *
 * Unknown roles are silently ignored; the orchestrator only consumes a
 * fixed set of *Enabled flags.
 *
 * @param {Decision} decision
 * @param {Object} pipelineFlags
 * @returns {Object} new flags object
 */
export function applyDecisionToFlags(decision, pipelineFlags = {}) {
  const next = { ...pipelineFlags };
  const flagFor = (role) => {
    if (role === "hu_reviewer") return "huReviewerEnabled";
    return `${role}Enabled`;
  };
  for (const role of decision.rolesOn) {
    next[flagFor(role)] = true;
  }
  for (const role of decision.rolesOff) {
    next[flagFor(role)] = false;
  }
  // Coder/security/reviewer aren't always toggled via flags in the current
  // orchestrator (coder is implicit). Don't touch fields the orchestrator
  // doesn't know; next simply carries them.
  return next;
}

export { VALID_ROLES };
