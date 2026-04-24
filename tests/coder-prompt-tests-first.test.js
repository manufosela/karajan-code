import { describe, expect, it } from "vitest";
import { buildCoderPrompt } from "../src/prompts/coder.js";

// Tests-first Phase 2 (v2.7.5): the coder prompt carries the HU's
// acceptance_tests so the coder knows the contract from turn 1, rather
// than learning it after the first failed run.

describe("buildCoderPrompt — acceptance_tests section", () => {
  it("is omitted when no tests are passed", async () => {
    const prompt = await buildCoderPrompt({ task: "do a thing" });
    expect(prompt).not.toMatch(/Acceptance Tests/);
  });

  it("renders a shell test as a fenced bash block", async () => {
    const prompt = await buildCoderPrompt({
      task: "implement login",
      acceptanceTests: [{ type: "shell", content: "npx vitest run login.test.ts" }],
    });
    expect(prompt).toMatch(/## Acceptance Tests — MUST pass/);
    expect(prompt).toMatch(/```bash\nnpx vitest run login\.test\.ts\n```/);
  });

  it("renders a gherkin test as a fenced gherkin block with preserved newlines", async () => {
    const prompt = await buildCoderPrompt({
      task: "implement login",
      acceptanceTests: [
        { type: "gherkin", content: "Given a logged-out user\nWhen they POST /login with valid creds\nThen the response is 200 and sets a session cookie" },
      ],
    });
    expect(prompt).toMatch(/```gherkin\nGiven a logged-out user\nWhen/);
    expect(prompt).toMatch(/Then the response is 200 and sets a session cookie\n```/);
  });

  it("accepts legacy plain-string tests (backward compat)", async () => {
    const prompt = await buildCoderPrompt({
      task: "legacy path",
      acceptanceTests: ["npx vitest run"],
    });
    expect(prompt).toMatch(/```bash\nnpx vitest run\n```/);
  });

  it("includes the file hint when provided", async () => {
    const prompt = await buildCoderPrompt({
      task: "targeted",
      acceptanceTests: [
        { type: "shell", content: "npx vitest run tests/auth.test.ts", file: "tests/auth.test.ts" },
      ],
    });
    expect(prompt).toMatch(/target: `tests\/auth\.test\.ts`/);
  });

  it("numbers multiple tests and keeps their order", async () => {
    const prompt = await buildCoderPrompt({
      task: "multi",
      acceptanceTests: [
        { type: "shell", content: "cmd-1" },
        { type: "gherkin", content: "Given a\nWhen b\nThen c" },
        { type: "shell", content: "cmd-3" },
      ],
    });
    expect(prompt).toMatch(/### Test 1 · `shell`/);
    expect(prompt).toMatch(/### Test 2 · `gherkin`/);
    expect(prompt).toMatch(/### Test 3 · `shell`/);
    const idx1 = prompt.indexOf("cmd-1");
    const idx2 = prompt.indexOf("Given a");
    const idx3 = prompt.indexOf("cmd-3");
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });

  it("nudges the coder to not silently rewrite ambiguous tests", async () => {
    const prompt = await buildCoderPrompt({
      task: "x",
      acceptanceTests: [{ type: "shell", content: "cmd" }],
    });
    expect(prompt).toMatch(/do NOT silently rewrite the test/);
  });
});
