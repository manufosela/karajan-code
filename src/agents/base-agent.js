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

  getRoleModel(role) {
    const roleModel = this.config?.roles?.[role]?.model;
    if (roleModel) return roleModel;
    if (role === "reviewer") return this.config?.reviewer_options?.model || null;
    return this.config?.coder_options?.model || null;
  }

  isAutoApproveEnabled(role) {
    if (role === "reviewer") return false;
    return Boolean(this.config?.coder_options?.auto_approve);
  }
}
