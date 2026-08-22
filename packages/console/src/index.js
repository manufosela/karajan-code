export { ConsoleConfigSchema, ConsoleConfigError, parseConsoleConfig, loadConsoleConfig, resolveRole } from "./config.js";
export { createAuth, AuthError, ROLE_RANK, IAP_HEADER } from "./auth.js";
export { createAudit, memorySink, fileSink, sinkFromConfig } from "./audit.js";
export { gcsSink } from "./sinks/gcs.js";
export { createRegistry, memoryAdapter, CAPABILITIES } from "./adapters/registry.js";
export { createConsoleApp, CONSOLE_VERSION } from "./app.js";
export { createCloudRunAdapter, createGoogleCloudAuth } from "./adapters/gcp-cloud-run.js";
export { createGithubWorkflowAdapter, appJwt, githubKeyFromEnv } from "./adapters/github-workflow.js";
// createIapVerifier lives in ./iap-verifier.js and is NOT re-exported here, like the Google one:
// both pull google-auth-library, and the tests must be able to import this module without it.
