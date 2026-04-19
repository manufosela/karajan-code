/**
 * Karajan configuration typedefs. Mirrors the shape produced by loadConfig()
 * and consumed throughout the orchestrator. Optional fields are intentional
 * — users may set them in kj.config.yml without every field being required.
 */

/**
 * @typedef {Object} RoleConfig
 * @property {string} [provider]    - claude | codex | gemini | opencode | aider | anthropic | openai | google
 * @property {string} [model]       - provider-specific model identifier
 */

/**
 * @typedef {Object} PipelineToggle
 * @property {boolean} [enabled]
 */

/**
 * @typedef {Object} PipelineFlags
 * @property {boolean} [coderEnabled]
 * @property {boolean} [reviewerEnabled]
 * @property {boolean} [plannerEnabled]
 * @property {boolean} [researcherEnabled]
 * @property {boolean} [architectEnabled]
 * @property {boolean} [refactorerEnabled]
 * @property {boolean} [testerEnabled]
 * @property {boolean} [securityEnabled]
 * @property {boolean} [impeccableEnabled]
 * @property {boolean} [triageEnabled]
 * @property {boolean} [discoverEnabled]
 * @property {boolean} [huReviewerEnabled]
 * @property {boolean} [coderRequired]
 */

/**
 * @typedef {Object} GitConfig
 * @property {boolean} [auto_commit]
 * @property {boolean} [auto_push]
 * @property {boolean} [auto_pr]
 * @property {boolean} [auto_rebase]
 * @property {string} [branch_prefix]
 */

/**
 * @typedef {Object} SonarConfig
 * @property {boolean} [enabled]
 * @property {string} [host]
 * @property {string} [token]
 * @property {boolean} [external]
 * @property {string} [enforcement_profile]
 */

/**
 * @typedef {Object} BudgetConfig
 * @property {Object} [pricing]
 * @property {number} [warn_threshold_pct]
 */

/**
 * @typedef {Object} BrainDecisorConfig
 * @property {boolean} [enabled]
 * @property {number} [maxDecisions]
 */

/**
 * @typedef {Object} BrainConfig
 * @property {boolean} [enabled]
 * @property {string} [provider]
 * @property {boolean} [bypass_solomon_on_correctness]
 * @property {number} [max_consecutive_verification_failures]
 * @property {BrainDecisorConfig} [decisor]
 */

/**
 * @typedef {Object} SkillsConfig
 * @property {boolean} [enabled]
 * @property {"auto"|"regex"|"semantic"|"none"} [mode]
 */

/**
 * @typedef {Object} PreflightConfig
 * @property {boolean} [extended]
 */

/**
 * Full Karajan configuration shape as resolved by loadConfig() +
 * applyRunOverrides(). Not every field is always present; consumers should
 * defensively read via `config.x?.y`.
 *
 * @typedef {Object} KarajanConfig
 * @property {string} [coder]                   - legacy agent name (claude, codex, ...)
 * @property {string} [reviewer]                - legacy agent name
 * @property {Object.<string, RoleConfig>} [roles]
 * @property {Object.<string, PipelineToggle>} [pipeline]
 * @property {string} [review_mode]             - standard | strict | paranoid | relaxed
 * @property {string} [review_rules]            - path to review rules .md
 * @property {number} [max_iterations]
 * @property {number} [max_budget_usd]
 * @property {BudgetConfig} [budget]
 * @property {SonarConfig} [sonarqube]
 * @property {GitConfig} [git]
 * @property {string} [base_branch]
 * @property {Object} [session]                 - timeouts etc
 * @property {Object} [output]                  - log level, report dir
 * @property {Object} [development]             - methodology, require_test_changes
 * @property {BrainConfig} [brain]
 * @property {SkillsConfig} [skills]
 * @property {PreflightConfig} [preflight]
 * @property {string} [projectDir]              - absolute path, set at runtime
 * @property {string} [productContext]          - runtime-loaded
 * @property {string} [domainContext]           - runtime-loaded
 */

export {};
