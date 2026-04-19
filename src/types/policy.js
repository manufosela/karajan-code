/**
 * Policy + quality-gate typedefs. Policies are resolved once per session
 * from config + task type; quality gates are the outputs of each gate
 * (sonar, perf, tests, review).
 */

/**
 * @typedef {Object} ResolvedPolicies
 * @property {boolean} [tdd]                    - whether TDD is enforced
 * @property {boolean} [sonar]                  - Sonar gate enabled
 * @property {boolean} [tests]                  - tester gate enabled
 * @property {boolean} [security]               - security audit enabled
 * @property {boolean} [reviewer]               - reviewer gate enabled
 * @property {boolean} [planner]                - planner enabled
 * @property {boolean} [researcher]             - researcher enabled
 * @property {boolean} [architect]              - architect enabled
 * @property {boolean} [refactorer]             - refactorer enabled
 * @property {boolean} [impeccable]             - impeccable audit enabled
 * @property {boolean} [triage]                 - triage enabled
 * @property {boolean} [discover]               - discover phase enabled
 * @property {boolean} [hu_reviewer]            - HU certification enabled
 * @property {number} [reviewer_retries]
 * @property {number} [tester_retries]
 * @property {string} [reason]                  - why these policies (task type + config chain)
 */

/**
 * Result of a quality gate evaluation — Sonar, perf, tester, reviewer, etc.
 *
 * @typedef {Object} QualityGateResult
 * @property {boolean} ok                       - did the gate pass
 * @property {"OK"|"FAIL"|"WARN"|"ERROR"} gateStatus
 * @property {string} [summary]
 * @property {Object[]} [blocking_issues]       - for reviewer/security gates
 * @property {number} [openIssues]              - sonar
 * @property {number} [issuesInitial]
 * @property {number} [issuesFinal]
 * @property {number} [issuesResolved]
 * @property {string} [provider]                - which agent produced the verdict (when relevant)
 * @property {Object} [details]                 - gate-specific payload
 */

export {};
