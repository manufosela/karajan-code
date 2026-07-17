// KJC-BUG-0109: in non-TTY --yes mode, a question that declares a safe
// default gets auto-answered with it instead of stopping the session.
import { describe, expect, it, vi } from "vitest";
import { createCliAskQuestion } from "../src/utils/cli-ask-question.js";

describe("createCliAskQuestion --yes defaults (KJC-BUG-0109)", () => {
  function nonTty() {
    // vitest stdin is not a TTY, so path 2 (no TTY + yes) is exercised
    // directly; guard the assumption so a TTY-attached runner fails loud.
    expect(Boolean(process.stdin?.isTTY)).toBe(false);
  }

  it("auto-answers with the declared default", async () => {
    nonTty();
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ask = createCliAskQuestion({ flags: { yes: true } });
    const answer = await ask("Spec review: 3 findings. [c]/[r]/[x]? (default: continue)", {
      detail: { severity: "info" },
      defaultAnswer: "continue",
    });
    expect(answer).toBe("continue");
    expect(write.mock.calls.map(c => c[0]).join("")).toContain("Auto-answering");
    write.mockRestore();
  });

  it("still stops loud when no default is declared", async () => {
    nonTty();
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ask = createCliAskQuestion({ flags: { yes: true } });
    const answer = await ask("Irreversible choice?", { detail: { severity: "blocker" } });
    expect(answer).toBeNull();
    expect(write.mock.calls.map(c => c[0]).join("")).toContain("cannot be auto-answered");
    write.mockRestore();
  });

  it("a blank declared default does not count", async () => {
    nonTty();
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ask = createCliAskQuestion({ flags: { yes: true } });
    const answer = await ask("Question?", { defaultAnswer: "   " });
    expect(answer).toBeNull();
    write.mockRestore();
  });
});
