/**
 * Recovery for a command that runs once (KJC-BUG-0194).
 *
 * The pipeline can afford to wait: a quota wall means hibernate, persist the
 * session and resume when the window reopens. A one-shot command cannot.
 * Sleeping five hours inside `kj code` or `kj audit` is worse than the failure
 * it is handling, and an MCP caller gets no answer at all.
 *
 * So here a quota wall takes the next declared candidate AT ONCE, and with
 * none left it stops and says what it tried. Everything else keeps the
 * pipeline's behaviour: a retired model still moves on immediately, provider
 * 500s still back off, an auth failure still aborts.
 */
import { DEFAULT_RECOVERY_POLICY } from "./with-brain-recovery.js";
import { ERROR_CLASS } from "./agent-error-classifier.js";

const takeTheNextOne = { mode: "abort", maxRetries: 0, fallbackEligible: true, fallbackImmediate: true };

export const ONE_SHOT_POLICY = Object.freeze({
  ...DEFAULT_RECOVERY_POLICY,
  classes: {
    ...DEFAULT_RECOVERY_POLICY.classes,
    [ERROR_CLASS.QUOTA_EXHAUSTED_DAILY]: takeTheNextOne,
    [ERROR_CLASS.QUOTA_EXHAUSTED_MONTHLY]: takeTheNextOne,
  },
});
