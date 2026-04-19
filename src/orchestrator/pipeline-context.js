/**
 * Shared context object for pipeline execution.
 * Replaces destructured parameter objects across orchestrator functions.
 *
 * @typedef {import("../types/config.js").KarajanConfig} KarajanConfig
 * @typedef {import("../types/session.js").Session} Session
 * @typedef {import("../types/stage.js").Logger} Logger
 * @typedef {import("../types/stage.js").Emitter} Emitter
 * @typedef {import("../types/stage.js").EventBase} EventBase
 * @typedef {import("../types/config.js").PipelineFlags} PipelineFlags
 * @typedef {import("../types/stage.js").StageContext} StageContext
 */
export class PipelineContext {
  /**
   * @param {Object} args
   * @param {KarajanConfig} args.config
   * @param {Session} args.session
   * @param {Logger} args.logger
   * @param {Emitter|null} args.emitter
   * @param {string} args.task
   * @param {Object} [args.flags]
   */
  constructor({ config, session, logger, emitter, task, flags = {} }) {
    this.config = config;
    this.session = session;
    this.logger = logger;
    this.emitter = emitter;
    this.task = task;
    this.flags = flags;

    // Pipeline state (set during execution)
    this.eventBase = {};
    this.pipelineFlags = {};
    this.trackBudget = null;
    this.budgetTracker = null;
    this.budgetLimit = null;
    this.budgetSummary = null;
    this.askQuestion = null;
    this.reviewRules = null;
    this.repeatDetector = null;
    this.sonarState = { issuesInitial: null, issuesFinal: null };
    this.stageResults = {};
    this.gitCtx = {};
    this.iteration = 0;

    // Roles (initialized during setup)
    this.coderRole = null;
    this.reviewerRole = null;
    this.refactorerRole = null;
    this.coderRoleInstance = null;

    // Planning Game context
    this.pgTaskId = null;
    this.pgProject = null;
    this.pgCard = null;

    // Product context (loaded from .karajan/context.md or product-vision.md)
    this.productContext = null;

    // Domain context (synthesized by Domain Curator from ~/.karajan/domains/ and .karajan/domains/)
    this.domainContext = null;

    // Planned task (may differ from original task after planner)
    this.plannedTask = null;

    // Karajan Brain runtime context (feedback queue, verification tracker, compression stats)
    this.brainCtx = null;

    // Timing
    this.startedAt = null;
  }
}
