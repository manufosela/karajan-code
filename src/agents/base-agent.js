export class BaseAgent {
  constructor(name, config, logger) {
    this.name = name;
    this.config = config;
    this.logger = logger;
  }

  async runTask(_task) {
    throw new Error("runTask not implemented");
  }

  async reviewTask(_task) {
    throw new Error("reviewTask not implemented");
  }
}
