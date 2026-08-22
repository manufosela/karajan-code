#!/usr/bin/env node
// C1 (KJC-TSK-0777, ADR 0007) — `karajan-console serve`: the reference way to
// run the console as a plain Node process (Cloud Run, a VM, a laptop). The
// Firebase/Cloud Run wrappers reuse createConsoleApp; this bin only wires
// the production pieces: Google verifier, ADC-backed adapters, the config.
import { CONSOLE_VERSION, createConsoleApp, loadConsoleConfig } from "../src/index.js";
import { createGoogleVerifier } from "../src/google-verifier.js";
import { createIapVerifier } from "../src/iap-verifier.js";
import { createCloudRunAdapter, createGoogleCloudAuth } from "../src/adapters/gcp-cloud-run.js";
import { createGithubWorkflowAdapter, githubKeyFromEnv } from "../src/adapters/github-workflow.js";
import { readFileSync } from "node:fs";

const die = (message) => { console.error(`karajan-console: ${message}`); process.exit(1); };

const args = process.argv.slice(2);
const opt = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

if (args[0] !== "serve") {
  console.error(`karajan-console ${CONSOLE_VERSION}\nusage: karajan-console serve [--config console.config.json] [--port 8080]\n  env: CONSOLE_CONFIG, PORT`);
  process.exit(args[0] === "--help" || args[0] === "-h" ? 0 : 1);
}

const configPath = opt("--config", process.env.CONSOLE_CONFIG || "console.config.json");
const config = loadConsoleConfig(configPath); // throws ConsoleConfigError listing every problem
const dryRun = process.env.KARAJAN_CONSOLE_ADAPTERS === "memory"; // no Google calls at all (bin smoke test)
const needsGcp = config.corpora.some((c) => c.adapter === "gcp-cloud-run") || config.audit.sink === "gcs-jsonl";
const gcpAuth = !dryRun && needsGcp ? await createGoogleCloudAuth() : null;
const adapters = {};
if (gcpAuth && config.corpora.some((c) => c.adapter === "gcp-cloud-run")) adapters["gcp-cloud-run"] = createCloudRunAdapter({ auth: gcpAuth });
// C2: operations need the console's GitHub App — ids in the config, the private key ONLY from the environment.
if (!dryRun && config.operations.some((o) => o.adapter === "github-workflow")) {
  if (!config.github) die("operations use github-workflow but console.config.json has no `github` ({ appId, installationId })");
  const privateKey = githubKeyFromEnv() ?? (process.env.CONSOLE_GITHUB_APP_KEY_FILE ? readFileSync(process.env.CONSOLE_GITHUB_APP_KEY_FILE, "utf8") : null);
  if (!privateKey) die("set CONSOLE_GITHUB_APP_KEY (PEM, \\n escapes honoured) or CONSOLE_GITHUB_APP_KEY_FILE — the GitHub App key never lives in the config");
  adapters["github-workflow"] = createGithubWorkflowAdapter({ github: { ...config.github, privateKey } });
}
// Who verifies the caller depends on the provider: Google's ID tokens, or IAP's own assertion.
const realVerifier = () => (config.auth.provider === "iap" ? createIapVerifier({ audience: config.auth.audience }) : createGoogleVerifier());
const verify = dryRun ? async () => { throw new Error("no verifier in dry run"); } : realVerifier();
const app = createConsoleApp({ config, verify, adapters, gcpAuth, ...(dryRun && config.audit.sink === "gcs-jsonl" ? { sink: (await import("../src/audit.js")).memorySink() } : {}) });
const port = Number(opt("--port", process.env.PORT || 8080));
const PHASE = { "gcp-secret-manager": "C3", "github-secret": "C3", "config-repo": "C4" };
const server = app.listen(port, () => {
  const { missing } = app.console;
  console.log(`karajan-console ${CONSOLE_VERSION} · ${config.instance.name} · http://localhost:${server.address().port} · config ${configPath} · auth ${config.auth.provider} · audit ${config.audit.sink}`);
  console.log(`adapters: ${app.console.registry.names().join(", ")}${missing.length ? ` · not in this build yet: ${missing.map((m) => `${m} (${PHASE[m] || "later"})`).join(", ")} — those operations stay unavailable until that phase ships; the config is fine` : ""}`);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
