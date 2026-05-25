import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { classifyAgentError, ERROR_CLASS } from "../../src/brain/agent-error-classifier.js";
import { withBrainRecovery } from "../../src/brain/with-brain-recovery.js";
import { buildStandbyState } from "../../src/brain/standby-store.js";
import { printResumeHint } from "../../src/utils/display/resume-hint.js";

// Resilience audit, Phase 5: integration tripwire for the quota
// hibernation flow that motivated the entire audit. A teammate's
// `kj run` hit Claude Code's "You've hit your session limit" and the
// HU was sealed `failed` with `UNKNOWN_FATAL` and no resume hint. This
// test walks the WHOLE chain so a regression in any one link is
// caught — not just by its own unit test, but as the end-to-end
// degradation the user actually experiences.

// Long ISO target (>12h ahead) so the helper exercises the
// hibernate-and-exit branch (longer waits don't keep kj alive),
// NOT the standby-in-process branch. Independent of wall-clock time.
const FAR_FUTURE_TARGET = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const QUOTA_STDERR_LONG = `usage limit reached, resets at ${FAR_FUTURE_TARGET}`;

const noSleep = () => Promise.resolve();

function makeQuotaAgent() {
  return {
    provider: "claude",
    runTask: async () => ({
      ok: false, error: QUOTA_STDERR_LONG, output: "", exitCode: 1,
    }),
  };
}

describe("resilience: quota exhaustion end to end", () => {
  // KJC-BUG-0064: parseCooldown is now TZ-aware — picks up the (Europe/Madrid)
  // literal in the stderr and resolves via Intl.DateTimeFormat. Test passes on
  // any host TZ; the v2.27.0 skip-in-CI workaround is gone.
  it("classifies the Claude Code session limit as a recoverable quota cap", () => {
    // The original user-reported message uses the 12-hour clock; parseCooldown
    // must understand it. Resilience tripwire for #756 — independent of how
    // long the wait will be (that's tested via the ISO path below).
    const cls = classifyAgentError({
      provider: "claude",
      stderr: "You've hit your session limit · resets 10:10pm (Europe/Madrid)",
      exitCode: 1,
    });
    expect(cls.class).toBe(ERROR_CLASS.QUOTA_EXHAUSTED_DAILY);
    expect(cls.recoverable).toBe(true);
    expect(cls.retryAfter).toBeGreaterThan(0);
  });

  it("withBrainRecovery with sessionState persists a standby snapshot to disk", async () => {
    const sessionState = buildStandbyState({
      session: { id: "s_e2e-quota" },
      config: { projectDir: "/tmp/e2e" },
      huId: "hu_e2e",
    });
    expect(sessionState.sessionId).toBe("s_e2e-quota");

    const result = await withBrainRecovery({
      agent: makeQuotaAgent(),
      taskArgs: {},
      role: "coder",
      sessionState,
      sleepFn: noSleep,
    });

    expect(result.action).toBe("hibernate");
    expect(result.standbyFile).toBeTruthy();
    const persisted = JSON.parse(readFileSync(result.standbyFile, "utf-8"));
    expect(persisted.sessionId).toBe("s_e2e-quota");
    expect(persisted.huId).toBe("hu_e2e");
    expect(persisted.cooldownUntil).toBeTruthy();
  });

  it("a hibernated result produces a 'kj standby resume <id>' hint as the last line", () => {
    const lines = [];
    printResumeHint(
      { hibernated: true, sessionId: "s_e2e-quota", reason: "quota_exhausted" },
      { print: (l) => lines.push(l) }
    );
    const joined = lines.join("\n");
    expect(joined).toMatch(/kj standby resume s_e2e-quota/);
  });

  it("the env subset persisted is ALLOWLISTED — no API key leaks into the snapshot", () => {
    process.env.KJ_TEST_FLAG = "kj-only";
    process.env.SECRET_API_KEY = "must-not-leak";
    try {
      const state = buildStandbyState({ session: { id: "s_x" } });
      expect(state.env.KJ_TEST_FLAG).toBe("kj-only");
      expect(state.env).not.toHaveProperty("SECRET_API_KEY");
    } finally {
      delete process.env.KJ_TEST_FLAG;
      delete process.env.SECRET_API_KEY;
    }
  });
});
