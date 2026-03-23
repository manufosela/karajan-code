/**
 * Shared context object for pipeline execution.
 * Replaces destructured parameter objects across orchestrator functions.
 */
export class PipelineContext {
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

    // Planned task (may differ from original task after planner)
    this.plannedTask = null;

    // Timing
    this.startedAt = null;
  }
}
