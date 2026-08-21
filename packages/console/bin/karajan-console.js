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
const adapters = {};
if (process.env.KARAJAN_CONSOLE_ADAPTERS === "memory") {
  // Dry run: no Google calls at all (used by the bin smoke test).
} else if (config.corpora.some((c) => c.adapter === "gcp-cloud-run")) {
  adapters["gcp-cloud-run"] = createCloudRunAdapter({ auth: await createGoogleCloudAuth() });
}
const verify = process.env.KARAJAN_CONSOLE_ADAPTERS === "memory" ? async () => { throw new Error("no verifier in dry run"); } : createGoogleVerifier();
const app = createConsoleApp({ config, verify, adapters });
const port = Number(opt("--port", process.env.PORT || 8080));
const server = app.listen(port, () => {
  const { missing } = app.console;
  console.log(`karajan-console ${CONSOLE_VERSION} · ${config.instance.name} · http://localhost:${server.address().port} · config ${configPath}`);
  console.log(`adapters: ${app.console.registry.names().join(", ")}${missing.length ? ` · MISSING for this config: ${missing.join(", ")}` : ""}`);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
