/**
 * Central JSDoc typedef registry. Import typedefs via:
 *
 *   /** @typedef {import("../types/index.js").KarajanConfig} KarajanConfig *\/
 *
 * This module re-exports every type so consumers have a single import path.
 * The actual typedef bodies live in the focused files under src/types/.
 *
 * Intentionally a runtime-empty module: it only carries JSDoc annotations,
 * nothing to execute.
 */

/**
 * @typedef {import("./config.js").KarajanConfig} KarajanConfig
 * @typedef {import("./config.js").RoleConfig} RoleConfig
 * @typedef {import("./config.js").PipelineFlags} PipelineFlags
 *
 * @typedef {import("./session.js").Session} Session
 * @typedef {import("./session.js").Checkpoint} Checkpoint
 *
 * @typedef {import("./stage.js").StageContext} StageContext
 * @typedef {import("./stage.js").StageResult} StageResult
 *
 * @typedef {import("./agent.js").AgentResult} AgentResult
 * @typedef {import("./agent.js").AgentResponse} AgentResponse
 *
 * @typedef {import("./hu.js").HUStory} HUStory
 * @typedef {import("./hu.js").HUBatch} HUBatch
 *
 * @typedef {import("./policy.js").ResolvedPolicies} ResolvedPolicies
 * @typedef {import("./policy.js").QualityGateResult} QualityGateResult
 *
 * @typedef {import("./solomon.js").Conflict} SolomonConflict
 * @typedef {import("./solomon.js").ConflictHistoryEntry} SolomonConflictHistoryEntry
 * @typedef {import("./solomon.js").SolomonResult} SolomonResult
 */

export {};
