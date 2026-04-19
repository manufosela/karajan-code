/**
 * Stage context + stage result typedefs. A StageContext is the bundle of
 * orchestration state every stage function receives; a StageResult is what
 * they return for downstream stages to consume.
 */

/**
 * @typedef {Object} Logger
 * @property {(msg: string, ...rest: any[]) => void} info
 * @property {(msg: string, ...rest: any[]) => void} warn
 * @property {(msg: string, ...rest: any[]) => void} error
 * @property {(msg: string, ...rest: any[]) => void} [debug]
 */

/**
 * @typedef {Object} Emitter
 * @property {(event: string, data?: any) => void} emit
 */

/**
 * Shape of `eventBase` propagated to every emitted event for correlation.
 *
 * @typedef {Object} EventBase
 * @property {string} sessionId
 * @property {number} iteration
 * @property {string|null} stage
 * @property {number} startedAt                  - epoch ms
 */

/**
 * The context every pipeline stage consumes. Most stages pick a subset with
 * destructuring. Listed here so consumers can import a single type instead
 * of re-declaring ad-hoc objects.
 *
 * @typedef {Object} StageContext
 * @property {import("./config.js").KarajanConfig} config
 * @property {import("./session.js").Session} session
 * @property {Logger} logger
 * @property {Emitter|null} emitter
 * @property {EventBase} eventBase
 * @property {Function} [trackBudget]
 * @property {Function} [budgetSummary]
 * @property {import("./config.js").PipelineFlags} [pipelineFlags]
 * @property {Object} [coderRole]                - CoderRole instance
 * @property {Object} [reviewerRole]
 * @property {Object} [brainCtx]
 * @property {Function} [askQuestion]
 * @property {Object} [stageResults]             - accumulated results from prior stages
 * @property {string} [task]
 * @property {string|null} [pgTaskId]
 * @property {string|null} [pgProject]
 * @property {Object} [flags]                    - CLI/call-time flags
 */

/**
 * The structured return of most stage helpers. Stages are allowed to return
 * shape-specific additions on top of these common fields.
 *
 * @typedef {Object} StageResult
 * @property {boolean} ok
 * @property {string} [summary]
 * @property {Object} [result]                   - stage-specific payload
 * @property {string} [action]                   - "return" | "retry" | "continue" | "skip" | ...
 * @property {Object} [stageResult]              - alternate nested result shape used by some stages
 * @property {string} [provider]
 */

export {};
