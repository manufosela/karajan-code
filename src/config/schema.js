/**
 * Central Valibot schema for Karajan's configuration surface (KJC-TSK-0318).
 *
 * Origin: this schema is based on Jorge del Casar's original work in PR #379
 * (closed). The full 650-line mirror-of-DEFAULTS approach he proposed drifted
 * heavily against `main` by the time it was reviewed, so this file takes the
 * same intent — validating Karajan config at load time with Valibot — but
 * narrows the scope to the handful of fields where validation actually
 * catches real bugs (review_mode, methodology, max_iterations, percentage
 * budgets, port numbers). Everything else is defined with `v.looseObject` /
 * `v.unknown()` so existing consumers who touch undeclared keys keep working.
 *
 * The runtime DEFAULTS object still lives in src/config.js — it is the source
 * of truth for default values. This schema exists to reject invalid input
 * early (e.g. `max_iterations: 0`, `review_mode: "yolo"`) with a clear error,
 * and to give downstream consumers a typed handle via `KarajanConfig`.
 *
 * @typedef {import("valibot").InferOutput<typeof ConfigSchema>} KarajanConfig
 */

import * as v from "valibot";

/**
 * Positive integer (>= 1). Used where 0 / negative would be a clear bug
 * (max_iterations, port, most timeout knobs when they gate the loop itself).
 */
const PositiveInt = v.pipe(
  v.number("must be a number"),
  v.integer("must be an integer"),
  v.minValue(1, "must be >= 1")
);

/**
 * Non-negative integer (>= 0). Used for retry counts where 0 is a valid
 * "don't retry" signal.
 */
const NonNegativeInt = v.pipe(
  v.number("must be a number"),
  v.integer("must be an integer"),
  v.minValue(0, "must be >= 0")
);

/**
 * review_mode picklist — anything outside this set is a typo.
 */
const ReviewMode = v.picklist(
  ["paranoid", "strict", "standard", "relaxed", "custom"],
  "review_mode must be one of: paranoid | strict | standard | relaxed | custom"
);

const Methodology = v.picklist(
  ["tdd", "standard"],
  "development.methodology must be one of: tdd | standard"
);

/**
 * KJC-TSK-0415: fallback chain. Cuando provider primario hits
 * QUOTA_EXHAUSTED_* con cooldown > max_wait_hours, switch a fallback.
 * Recursivo — el fallback puede tener su propio fallback.
 */
const RoleFallback = v.looseObject({
  provider: v.string("fallback.provider required (claude|codex|gemini|opencode|aider)"),
  model: v.optional(v.nullable(v.string())),
  max_wait_hours: v.optional(v.pipe(v.number(), v.minValue(0)), 12),
  // Recursivo. Schema permite cualquier shape compatible con RoleFallback.
  fallback: v.optional(v.lazy(() => RoleFallback)),
});

/**
 * Role entry — provider + model, both nullable. Extra keys allowed.
 * KJC-TSK-0415: campo fallback opcional para Plan B en quota exhausted.
 */
const RoleEntry = v.looseObject({
  provider: v.optional(v.nullable(v.string())),
  model: v.optional(v.nullable(v.string())),
  fallback: v.optional(RoleFallback),
});

const RolesMap = v.optional(v.looseObject({
  planner: v.optional(RoleEntry),
  coder: v.optional(RoleEntry),
  reviewer: v.optional(RoleEntry),
  refactorer: v.optional(RoleEntry),
  solomon: v.optional(RoleEntry),
  researcher: v.optional(RoleEntry),
  tester: v.optional(RoleEntry),
  security: v.optional(RoleEntry),
  impeccable: v.optional(RoleEntry),
  triage: v.optional(RoleEntry),
  discover: v.optional(RoleEntry),
  architect: v.optional(RoleEntry),
  hu_reviewer: v.optional(RoleEntry),
  start: v.optional(RoleEntry),
}));

const PipelineEntry = v.looseObject({
  enabled: v.optional(v.boolean()),
});

const PipelineMap = v.optional(v.looseObject({
  planner: v.optional(PipelineEntry),
  refactorer: v.optional(PipelineEntry),
  solomon: v.optional(PipelineEntry),
  researcher: v.optional(PipelineEntry),
  tester: v.optional(PipelineEntry),
  security: v.optional(PipelineEntry),
  impeccable: v.optional(PipelineEntry),
  perf: v.optional(PipelineEntry),
  triage: v.optional(PipelineEntry),
  discover: v.optional(PipelineEntry),
  architect: v.optional(PipelineEntry),
  hu_reviewer: v.optional(PipelineEntry),
  auto_simplify: v.optional(v.boolean()),
}));

const Development = v.optional(v.looseObject({
  methodology: v.optional(Methodology),
  require_test_changes: v.optional(v.boolean()),
  // KJC-TSK-0398: opt-in flag; module lands in PR1, integration in PR3.
  require_red_then_green: v.optional(v.boolean()),
  test_file_patterns: v.optional(v.array(v.string())),
  source_file_extensions: v.optional(v.array(v.string())),
}));

const Git = v.optional(v.looseObject({
  auto_commit: v.optional(v.boolean()),
  auto_push: v.optional(v.boolean()),
  auto_pr: v.optional(v.boolean()),
  auto_rebase: v.optional(v.boolean()),
  branch_prefix: v.optional(v.string()),
}));

const ReviewerOptions = v.optional(v.looseObject({
  output_format: v.optional(v.string()),
  require_schema: v.optional(v.boolean()),
  model: v.optional(v.nullable(v.string())),
  deterministic: v.optional(v.boolean()),
  retries: v.optional(NonNegativeInt, 1),
  fallback_reviewer: v.optional(v.nullable(v.string())),
}));

const CoderOptions = v.optional(v.looseObject({
  model: v.optional(v.nullable(v.string())),
  auto_approve: v.optional(v.boolean()),
  fallback_coder: v.optional(v.nullable(v.string())),
}));

const HuBoard = v.optional(v.looseObject({
  enabled: v.optional(v.boolean()),
  port: v.optional(v.pipe(
    v.number("hu_board.port must be a number"),
    v.integer(),
    v.minValue(1, "hu_board.port must be >= 1"),
    v.maxValue(65535, "hu_board.port must be <= 65535")
  )),
  auto_start: v.optional(v.boolean()),
}));

/**
 * Budget warn threshold: 0-100 percent. Anything outside is nonsense.
 */
const Budget = v.optional(v.looseObject({
  warn_threshold_pct: v.optional(v.pipe(
    v.number(),
    v.minValue(0, "budget.warn_threshold_pct must be 0-100"),
    v.maxValue(100, "budget.warn_threshold_pct must be 0-100")
  )),
  currency: v.optional(v.string()),
  exchange_rate_eur: v.optional(v.number()),
  pricing: v.optional(v.unknown()),
}));

/**
 * skills.addyosmani subtree (KJC-TSK-0327). Governs the addyosmani/agent-skills
 * catalog provider: enabled flag, refresh TTL and repo URL.
 */
const SkillsAddyosmani = v.looseObject({
  enabled: v.optional(v.boolean()),
  refreshDays: v.optional(v.pipe(
    v.number(),
    v.minValue(0, "skills.addyosmani.refreshDays must be >= 0")
  )),
  repoUrl: v.optional(v.string()),
});

/**
 * skills.* subtree. `sources` controls which providers Karajan consults and in
 * what order (addyosmani → openskills → local by default). `mode` is the
 * existing regex/semantic/auto/none knob from semantic-detector.js.
 */
const Skills = v.optional(v.looseObject({
  mode: v.optional(v.picklist(["auto", "regex", "semantic", "none"], "skills.mode must be one of: auto | regex | semantic | none")),
  sources: v.optional(v.array(v.string())),
  addyosmani: v.optional(SkillsAddyosmani),
}));

/**
 * KJC-TSK-0407: routing automático de modelos por HU según complexity.
 *   - by_provider: override de tiers per provider (claude/codex/gemini).
 *     Cada provider mapea level → modelo. Sobreescribe defaults del router.
 *   - fixed.coder / fixed.reviewer: si presentes, override TOTAL — todas
 *     las HUs usan esos modelos independientemente del score. Útil para
 *     forzar Sonnet en todo el proyecto, por ejemplo.
 */
const ModelRouting = v.optional(v.looseObject({
  by_provider: v.optional(v.record(
    v.string(),
    v.looseObject({
      trivial: v.optional(v.string()),
      simple: v.optional(v.string()),
      medium: v.optional(v.string()),
      complex: v.optional(v.string()),
    })
  )),
  fixed: v.optional(v.looseObject({
    coder: v.optional(v.nullable(v.string())),
    reviewer: v.optional(v.nullable(v.string())),
  })),
}));

/**
 * Main config schema. `looseObject` lets every consumer that reads an
 * undeclared key keep working while the schema catches the bugs we care
 * about.
 */
export const ConfigSchema = v.looseObject({
  coder: v.optional(v.string()),
  reviewer: v.optional(v.string()),
  roles: RolesMap,
  pipeline: PipelineMap,
  review_mode: v.optional(ReviewMode),
  max_iterations: v.optional(PositiveInt, 5),
  hu_max_iterations: v.optional(PositiveInt, 3),
  max_budget_usd: v.optional(v.nullable(v.pipe(
    v.number(),
    v.minValue(0, "max_budget_usd must be >= 0")
  ))),
  // ENV-D1 (KJC-TSK-0642): where work items live — the integrated HU Board
  // or the user's Planning Game. The v4 playbook renders per backend.
  state_backend: v.optional(v.picklist(
    // KJC-TSK-0709 caught the drift: "external" shipped in v4.5.0 (any
    // board via the agent's own MCP/tools) but this picklist never learned it.
    ["hu-board", "planning-game", "external"],
    "state_backend must be \"hu-board\", \"planning-game\" or \"external\""
  )),
  review_rules: v.optional(v.string()),
  coder_rules: v.optional(v.string()),
  base_branch: v.optional(v.string()),
  coder_options: CoderOptions,
  reviewer_options: ReviewerOptions,
  development: Development,
  git: Git,
  hu_board: HuBoard,
  budget: Budget,
  language: v.optional(v.string()),
  hu_language: v.optional(v.string()),
  policies: v.optional(v.record(v.string(), v.unknown())),
  telemetry: v.optional(v.boolean()),
  skills: Skills,
  model_routing: ModelRouting,
});

/**
 * Parse a raw merged config against the schema. Returns the normalized
 * config or throws a Valibot ValiError. Call sites should wrap this in a
 * try/catch that re-throws with a friendlier prefix.
 *
 * @param {unknown} input
 * @returns {KarajanConfig}
 */
export function parseConfig(input) {
  return v.parse(ConfigSchema, input);
}

/**
 * Safe variant — returns { success, data } | { success: false, issues } so
 * callers can decide how to report errors without catching ValiError.
 * @param {unknown} input
 */
export function safeParseConfig(input) {
  const result = v.safeParse(ConfigSchema, input);
  if (result.success) return { success: true, data: result.output };
  return {
    success: false,
    issues: result.issues.map(i => ({
      path: (i.path || []).map(p => p.key).join("."),
      message: i.message,
    })),
  };
}

/**
 * Aggregate Valibot issues into a single readable string. Used by loadConfig
 * to produce actionable error messages instead of the default ValiError dump.
 * @param {Array<{path: string, message: string}>} issues
 */
export function formatConfigIssues(issues) {
  return issues.map(i => (i.path ? `${i.path}: ${i.message}` : i.message)).join("\n");
}
