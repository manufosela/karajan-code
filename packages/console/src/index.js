export { ConsoleConfigSchema, ConsoleConfigError, parseConsoleConfig, loadConsoleConfig, resolveRole } from "./config.js";
export { createAuth, AuthError, ROLE_RANK } from "./auth.js";
export { createAudit, memorySink, fileSink, sinkFromConfig } from "./audit.js";
export { createRegistry, memoryAdapter, CAPABILITIES } from "./adapters/registry.js";
export { createConsoleApp, CONSOLE_VERSION } from "./app.js";
