// Shim: plan-validation now lives in @karajan/core/plan-validation so
// the hu-board workspace can consume it without a relative dep on the
// CLI src tree. KJC-TSK-0511 PR6.
export { validateBlockedByChange } from "@karajan/core/plan-validation";
