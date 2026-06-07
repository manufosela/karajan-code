// Shim — the real implementation now lives in @karajan/core/atomic-write.
// Kept here so CLI callers (src/**/*.js) keep importing
// "#utils/atomic-write.js" without churn during KJC-TSK-0511 (decouple
// @karajan/hu-board). Will be retired once every consumer migrates to
// the @karajan/core import.
export { writeJsonAtomic, writeJsonAtomicSync } from "@karajan/core/atomic-write";
