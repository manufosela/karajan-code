#!/usr/bin/env node
// C1 (KJC-TSK-0777, ADR 0007) — `karajan-console serve`: the reference way to
// run the console as a plain Node process (Cloud Run, a VM, a laptop). The
// Firebase/Cloud Run wrappers reuse createConsoleApp; this bin only wires
// the production pieces: Google verifier, ADC-backed adapters, the config.
import { CONSOLE_VERSION, createConsoleApp, loadConsoleConfig } from "../src/index.js";
import { createGoogleVerifier } from "../src/google-verifier.js";
import { createCloudRunAdapter, createGoogleCloudAuth } from "../src/adapters/gcp-cloud-run.js";

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
const verify = dryRun ? async () => { throw new Error("no verifier in dry run"); } : createGoogleVerifier();
const app = createConsoleApp({ config, verify, adapters, gcpAuth, ...(dryRun && config.audit.sink === "gcs-jsonl" ? { sink: (await import("../src/audit.js")).memorySink() } : {}) });
const port = Number(opt("--port", process.env.PORT || 8080));
const PHASE = { "github-workflow": "C2", "gcp-secret-manager": "C3", "github-secret": "C3", "config-repo": "C4" };
const server = app.listen(port, () => {
  const { missing } = app.console;
  console.log(`karajan-console ${CONSOLE_VERSION} · ${config.instance.name} · http://localhost:${server.address().port} · config ${configPath} · audit ${config.audit.sink}`);
  console.log(`adapters: ${app.console.registry.names().join(", ")}${missing.length ? ` · not in this build yet: ${missing.map((m) => `${m} (${PHASE[m] || "later"})`).join(", ")} — those operations stay unavailable until that phase ships; the config is fine` : ""}`);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
