/**
 * HU (Historia de Usuario) typedefs. An HU is a user story that the
 * pipeline can decompose into, certify via hu-reviewer, then run as a
 * sub-pipeline.
 */

/**
 * @typedef {"pending"|"planned"|"in_progress"|"done"|"rejected"|"blocked"|"failed"} HUStatus
 */

/**
 * @typedef {Object} HUAcceptanceCriterion
 * @property {string} [given]
 * @property {string} [when]
 * @property {string} [then]
 * @property {string} [raw]                     - plain-text AC if not Gherkin
 */

/**
 * @typedef {Object} HUStory
 * @property {string} id                        - stable slug per batch
 * @property {string} title
 * @property {string} [role]                    - "Como ..."
 * @property {string} [goal]                    - "Quiero ..."
 * @property {string} [benefit]                 - "Para ..."
 * @property {HUAcceptanceCriterion[]} [acceptanceCriteria]
 * @property {HUStatus} [status]
 * @property {string} [assignee]
 * @property {string[]} [dependencies]          - ids of HUs that must be done first
 * @property {Object} [certification]           - hu-reviewer verdict
 * @property {Object} [session]                 - sub-pipeline session metadata when it runs
 */

/**
 * A batch is the ordered collection of HUs produced by the auto-generator
 * or loaded from a YAML file.
 *
 * @typedef {Object} HUBatch
 * @property {string} id                        - typically the parent sessionId
 * @property {string} [task]                    - original task text
 * @property {HUStory[]} stories
 * @property {string} [created_at]
 * @property {string} [updated_at]
 * @property {Object} [board]                   - HU Board metadata (port, URL)
 */

export {};
