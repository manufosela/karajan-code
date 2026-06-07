// Shim — the real implementation now lives in @karajan/core/port-check.
// Kept here so CLI callers (src/**/*.js) keep importing
// "../utils/port-check.js" without churn during KJC-TSK-0511 (decouple
// @karajan/hu-board). Will be retired once every consumer migrates to
// the @karajan/core import.
export { isPortAvailable, findAvailablePort } from "@karajan/core/port-check";
