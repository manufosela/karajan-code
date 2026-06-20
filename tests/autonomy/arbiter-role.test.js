import { describe, expect, it, vi } from "vitest";

import { ArbiterRole } from "../../src/autonomy/arbiter-role.js";
import { createArbiter } from "../../src/autonomy/arbiter.js";
import { buildArbiterPrompt, VERDICTS } from "../../src/prompts/arbiter.js";

const agentReturning = (output) => () => ({ async runTask() { return { ok: true, output, usage: {} }; } });
const role = (output) => new ArbiterRole({ config: {}, logger: { warn: vi.fn() }, createAgentFn: agentReturning(output) });
const CONFLICT = { question: "Reviewer rejects but acceptance tests pass", options: VERDICTS.map((v) => ({ value: v })) };

describe("buildArbiterPrompt", () => {
  it("states the ground-truth order and the allowed verdicts", () => {
    const p = buildArbiterPrompt(CONFLICT);
    expect(p).toContain("Acceptance tests passing");
    expect(p).toContain("least-bad");
    expect(p).toContain("ACCEPT_WITH_DEFECT");
  });
});

describe("ArbiterRole", () => {
  it("returns a valid verdict and clamps confidence", async () => {
    const out = await role(JSON.stringify({ verdict: "ACCEPT_WITH_DEFECT", confidence: 5, rationale: "tests pass", defect: "minor style" })).execute(CONFLICT);
    expect(out.result).toMatchObject({ verdict: "ACCEPT_WITH_DEFECT", confidence: 1, defect: "minor style" });
  });

  it("coerces an out-of-set verdict to the conservative BLOCK_AND_CONTINUE", async () => {
    const out = await role(JSON.stringify({ verdict: "DELETE_EVERYTHING", confidence: 0.9 })).execute(CONFLICT);
    expect(out.result.verdict).toBe("BLOCK_AND_CONTINUE");
  });

  it("degrades garbage output to BLOCK_AND_CONTINUE without crashing (ok stays true)", async () => {
    const out = await role("the model rambled with no json").execute(CONFLICT);
    expect(out.ok).toBe(true);
    expect(out.result.verdict).toBe("BLOCK_AND_CONTINUE");
  });
});

describe("createArbiter adapter", () => {
  it("maps the verdict to a resolver choice", async () => {
    const arbiter = createArbiter({ config: {}, createAgentFn: agentReturning(JSON.stringify({ verdict: "RETRY_DIFFERENT_APPROACH", rationale: "try DI", directive: "inject the dep" })) });
    expect(await arbiter(CONFLICT)).toMatchObject({ choice: "RETRY_DIFFERENT_APPROACH", rationale: "try DI", directive: "inject the dep" });
  });
});
