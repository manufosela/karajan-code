// Shim: plan-id primitives now live in @karajan/core/plan-id so the
// hu-board workspace can consume them without a relative dep on the
// CLI src tree. KJC-TSK-0511 PR5.
export { generatePlanId, generateHuId, normaliseAlias } from "@karajan/core/plan-id";
