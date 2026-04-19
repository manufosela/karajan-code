/**
 * Agent result / response typedefs. Every provider agent (claude, codex,
 * gemini, opencode, aider) returns a shape that's a superset of AgentResult.
 *
 * AgentResponse<T> is the generic wrapper used when a caller has parsed
 * the raw output into a structured payload of type T.
 */

/**
 * Raw agent result as returned by agent.runTask() / agent.reviewTask().
 *
 * @typedef {Object} AgentResult
 * @property {boolean} ok                       - whether the call succeeded
 * @property {string} [output]                  - raw stdout / response text
 * @property {string} [summary]                 - short human summary
 * @property {Object} [result]                  - structured result (stage-specific)
 * @property {string} [error]
 * @property {string} [stderr]
 * @property {string} [stdout]
 * @property {number} [exitCode]
 * @property {AgentUsage} [usage]
 * @property {string} [provider]
 * @property {string} [model]
 */

/**
 * Token/cost reporting shape. Fields optional because not all providers
 * report all metrics.
 *
 * @typedef {Object} AgentUsage
 * @property {number} [input_tokens]
 * @property {number} [output_tokens]
 * @property {number} [cached_tokens]
 * @property {number} [total_tokens]
 * @property {number} [cost_usd]
 */

/**
 * Generic agent response — AgentResult whose `result` field is typed.
 *
 * Example:
 *   /** @type {import("../types/agent.js").AgentResponse<import("./review-result.js").ReviewResult>} *\/
 *
 * @template T
 * @typedef {Object} AgentResponse
 * @property {boolean} ok
 * @property {T} [result]
 * @property {string} [output]
 * @property {string} [summary]
 * @property {string} [error]
 * @property {AgentUsage} [usage]
 * @property {string} [provider]
 */

export {};
