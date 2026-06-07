// Shim: run-registry now lives in @karajan/core/run-registry so the
// hu-board workspace can consume it without a relative dep on the CLI
// src tree. KJC-TSK-0511 PR3.
export {
  runsDir,
  registerRun,
  unregisterRun,
  listActiveRuns,
} from "@karajan/core/run-registry";
