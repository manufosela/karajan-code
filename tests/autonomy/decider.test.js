import { describe, expect, it, vi } from "vitest";

import { buildDecider } from "../../src/autonomy/decider.js";

const agentReturning = (output) => () => ({ async runTask() { return { ok: true, output, usage: {} }; } });
const OPTIONS = [
  { value: "PROCEED", conservative: true },
  { value: "RETRY_DIFFERENT_APPROACH" },
];

describe("buildDecider", () => {
  it("interactive: resolves via the human ask, no arbiter", async () => {
    const ask = vi.fn().mockResolvedValue("PROCEED");
    const { autonomy, resolve } = buildDecider({ config: {}, flags: {}, ask });
    expect(autonomy).toBe("interactive");
    const out = await resolve({ question: "Q?", options: OPTIONS });
    expect(out.source).toBe("human");
    expect(ask).toHaveBeenCalled();
  });

  it("autonomous: resolves via the Arbiter, never touches the human ask", async () => {
    const ask = vi.fn();
    const { autonomy, resolve } = buildDecider({
      config: {},
      flags: { autonomous: true },
      ask,
      createAgentFn: agentReturning(JSON.stringify({ verdict: "PROCEED", confidence: 0.9, rationale: "best reading" })),
    });
    expect(autonomy).toBe("autonomous");
    const out = await resolve({ question: "Q?", options: OPTIONS });
    expect(out).toMatchObject({ choice: "PROCEED", source: "arbiter" });
    expect(ask).not.toHaveBeenCalled();
  });
});
