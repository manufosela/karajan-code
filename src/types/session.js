/**
 * Session state typedefs. The session is a mutable object that accumulates
 * state throughout a kj run and is persisted to ~/.karajan/sessions/<id>/.
 */

/**
 * @typedef {Object} Checkpoint
 * @property {string} [at]                   - ISO timestamp
 * @property {string} [stage]
 * @property {number} [iteration]
 * @property {string} [conflictStage]
 * @property {string} [ruling]
 * @property {string} [alternativeAgent]
 * @property {string} [waitUntil]
 * @property {string[]} [conditions]
 * @property {boolean} [escalate]
 * @property {string} [error]
 * @property {string|null} [subtask]
 */

/**
 * @typedef {Object} SolomonRulingRecord
 * @property {string} at                     - ISO timestamp
 * @property {string} stage
 * @property {string} trigger
 * @property {Object} conflict
 * @property {string} ruling                 - approve | approve_with_conditions | escalate_human | create_subtask | ...
 * @property {string} [reasoning]
 * @property {string[]} [conditions]
 * @property {string|null} [alternativeAgent]
 * @property {string} [result]
 */

/**
 * @typedef {Object} BrainDecisionRecord
 * @property {number} seq
 * @property {string} at
 * @property {string} intent                 - "<taskType>:<level>"
 * @property {string[]} rolesOn
 * @property {string} confidence             - low | medium | high
 * @property {string} rationale
 * @property {string[]} appliedOverrides
 */

/**
 * @typedef {Object} RtkSavings
 * @property {number} [callCount]
 * @property {number} [estimatedTokensSaved]
 * @property {number} [savedPct]
 * @property {number} [originalBytes]
 * @property {number} [rtkBytes]
 */

/**
 * @typedef {Object} Session
 * @property {string} id                     - session id
 * @property {string} task                   - user's task text
 * @property {"running"|"paused"|"approved"|"rejected"|"failed"} status
 * @property {string} created_at             - ISO timestamp
 * @property {string} updated_at
 * @property {Checkpoint[]} [checkpoints]
 * @property {SolomonRulingRecord[]} [solomonRulings]     - KJC-TSK-0287
 * @property {BrainDecisionRecord[]} [brainDecisions]     - KJC-TSK-0322
 * @property {string[]} [skillsRecommended]               - wouldHaveUsed when openskills missing
 * @property {string[]} [autoInstalledSkills]
 * @property {RtkSavings} [rtk_savings]
 * @property {string} [session_start_sha]                 - baseline for `git diff`; may be the empty-tree SHA when no prior commits exist
 * @property {string} [head_at_start]                     - actual HEAD when the run started; used by the post-loop journal to enumerate commits produced BY the run. Falls back to session_start_sha in zero-commits repos. (2026-05-07 dogfooding fix.)
 * @property {string} [_journalDir]                       - runtime journal path
 * @property {string[]} [_journalIterations]              - rendered iteration markdown
 * @property {string[]} [_journalFiles]
 * @property {Object} [budget]                            - final budget summary snapshot
 */

export {};
