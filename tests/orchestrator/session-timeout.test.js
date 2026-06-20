import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/session/store.js", () => ({ markSessionStatus: vi.fn() }));

import { checkSessionTimeout } from "../../src/orchestrator/flow-control.js";

const base = {
  config: { session: { max_total_minutes: 120 } },
  session: {},
  emitter: null,
  eventBase: {},
  i: 1,
  budgetSummary: () => ({}),
};

describe("checkSessionTimeout (AUTO-D wall-clock)", () => {
  it("never fires within the time budget", async () => {
    await expect(checkSessionTimeout({ ...base, askQuestion: null, elapsedMinutes: 10 })).resolves.toBeUndefined();
  });

  it("interactive runs skip the wall-clock even past the budget (the human decides)", async () => {
    const interactiveAsk = () => {}; // truthy, no `unattended` marker
    await expect(checkSessionTimeout({ ...base, askQuestion: interactiveAsk, elapsedMinutes: 999 })).resolves.toBeUndefined();
  });

  it("autonomous runs ENFORCE the wall-clock past the budget — closes the runaway gap", async () => {
    const autonomousAsk = Object.assign(() => {}, { unattended: true });
    await expect(checkSessionTimeout({ ...base, askQuestion: autonomousAsk, elapsedMinutes: 999 })).rejects.toThrow(/timed out/i);
  });

  it("non-interactive runs still enforce it (unchanged behaviour)", async () => {
    await expect(checkSessionTimeout({ ...base, askQuestion: null, elapsedMinutes: 999 })).rejects.toThrow(/timed out/i);
  });
});
