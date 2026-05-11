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

// PR F (v2.7.5): the coder prompt absorbs three more pieces of plan
// context — ADRs (constrains HOW you implement), the SPEC section
// pointer (what the HU is satisfying), and the plan-reviewer findings
// filtered to entries that actually mention the current HU.

describe("buildCoderPrompt — ADR section", () => {
  it("is omitted when no ADRs are passed", async () => {
    const prompt = await buildCoderPrompt({ task: "do a thing" });
    expect(prompt).not.toMatch(/Architecture Decision Records/);
  });

  it("is omitted when ADRs is an empty array", async () => {
    const prompt = await buildCoderPrompt({ task: "do a thing", adrs: [] });
    expect(prompt).not.toMatch(/Architecture Decision Records/);
  });

  it("renders the ADR markdown verbatim with a MUST-respect preamble", async () => {
    const md = "# 0001 — Use Vitest\n\n## Context\nWe need a JS runner.\n\n## Decision\nVitest.\n\n## Consequences\n- Fast.\n";
    const prompt = await buildCoderPrompt({
      task: "wire it up",
      adrs: [{ id: "0001-use-vitest", markdown: md }],
    });
    expect(prompt).toMatch(/## Architecture Decision Records \(active\)/);
    expect(prompt).toMatch(/MUST respect them/);
    expect(prompt).toContain(md.trim());
  });

  it("caps at 8 ADRs and notes how many were truncated", async () => {
    const adrs = Array.from({ length: 11 }, (_, i) => ({
      id: `${String(i + 1).padStart(4, "0")}-x`,
      markdown: `# ADR ${i + 1}\nbody-${i + 1}`,
    }));
    const prompt = await buildCoderPrompt({ task: "x", adrs });
    expect(prompt).toMatch(/body-1\b/);
    expect(prompt).toMatch(/body-8\b/);
    expect(prompt).not.toMatch(/body-9\b/);
    expect(prompt).toMatch(/3 more ADRs not shown/);
  });
});

describe("buildCoderPrompt — SPEC section pointer", () => {
  it("is omitted when no specSection is passed", async () => {
    const prompt = await buildCoderPrompt({ task: "x" });
    expect(prompt).not.toMatch(/SPEC reference/);
  });

  it("renders a one-line pointer the coder can cite", async () => {
    const prompt = await buildCoderPrompt({ task: "x", specSection: "5.3" });
    expect(prompt).toMatch(/## SPEC reference/);
    expect(prompt).toMatch(/§5\.3/);
    expect(prompt).toMatch(/Cite this section in your PR description/);
  });
});

describe("buildCoderPrompt — reviewer findings filtered per HU", () => {
  const huId = "hu_p001_002";

  it("is omitted when there are no findings", async () => {
    const prompt = await buildCoderPrompt({ task: "x", huId });
    expect(prompt).not.toMatch(/Reviewer findings about this HU/);
  });

  it("is omitted when no finding mentions this HU", async () => {
    const prompt = await buildCoderPrompt({
      task: "x",
      huId,
      reviewerFindings: {
        missing_dependencies: [{ from: "hu_p001_007", on: "hu_p001_009", rationale: "irrelevant" }],
        scope_overlaps: [{ between: ["hu_p001_004", "hu_p001_005"], rationale: "irrelevant" }],
        order_issues: [{ hus: ["hu_p001_010"], issue: "x", rationale: "irrelevant" }],
      },
    });
    expect(prompt).not.toMatch(/Reviewer findings about this HU/);
  });

  it("renders missing_dependency where the HU is the source", async () => {
    const prompt = await buildCoderPrompt({
      task: "x",
      huId,
      reviewerFindings: {
        missing_dependencies: [{ from: huId, on: "hu_p001_001", rationale: "needs schema first" }],
      },
    });
    expect(prompt).toMatch(/should depend on \*\*hu_p001_001\*\*/);
    expect(prompt).toMatch(/needs schema first/);
  });

  it("renders missing_dependency where the HU is the target", async () => {
    const prompt = await buildCoderPrompt({
      task: "x",
      huId,
      reviewerFindings: {
        missing_dependencies: [{ from: "hu_p001_005", on: huId, rationale: "consumes the API" }],
      },
    });
    expect(prompt).toMatch(/HU \*\*hu_p001_005\*\* should depend on this one/);
    expect(prompt).toMatch(/consumes the API/);
  });

  it("renders scope_overlaps and lists the other HUs", async () => {
    const prompt = await buildCoderPrompt({
      task: "x",
      huId,
      reviewerFindings: {
        scope_overlaps: [{ between: [huId, "hu_p001_004", "hu_p001_005"], rationale: "both touch /api/users" }],
      },
    });
    expect(prompt).toMatch(/Scope overlap with \*\*hu_p001_004, hu_p001_005\*\*/);
    expect(prompt).toMatch(/both touch \/api\/users/);
  });

  it("renders order_issues that mention the HU", async () => {
    const prompt = await buildCoderPrompt({
      task: "x",
      huId,
      reviewerFindings: {
        order_issues: [{ hus: [huId, "hu_p001_001"], issue: "wrong-order", rationale: "schema must land first" }],
      },
    });
    expect(prompt).toMatch(/Order issue \(wrong-order\)/);
    expect(prompt).toMatch(/schema must land first/);
  });
});

// regression-for: BUG-0032, bug
describe("buildCoderPrompt — projectDir boundary rule (PR-I, KJC-BUG-0032)", () => {
  it("renders the CRITICAL boundary section when projectDir is present", async () => {
    const prompt = await buildCoderPrompt({
      task: "Initialize project skeleton: create assistant/ directory",
      projectDir: "/home/user/my-project",
    });
    expect(prompt).toMatch(/CRITICAL — Project directory boundary/);
    expect(prompt).toContain("/home/user/my-project");
    expect(prompt).toMatch(/EVERY file you create.*MUST stay inside/);
    expect(prompt).toMatch(/RELATIVE to the project root/);
    expect(prompt).toMatch(/post-coder guard/);
  });

  it("omits the section when projectDir is null (legacy callers)", async () => {
    const prompt = await buildCoderPrompt({ task: "fix typo" });
    expect(prompt).not.toMatch(/Project directory boundary/);
  });

  it("forbids absolute paths under $HOME explicitly", async () => {
    const prompt = await buildCoderPrompt({
      task: "x", projectDir: "/proj",
    });
    expect(prompt).toMatch(/\/home\/USER\/something/);
    expect(prompt).toMatch(/Forbidden/);
  });
});

describe("buildCoderPrompt — section ordering for plan-aware run", () => {
  it("renders ADRs → SPEC ref → reviewer findings → acceptance tests in that order", async () => {
    const huId = "hu_p001_002";
    const prompt = await buildCoderPrompt({
      task: "implement",
      adrs: [{ id: "0001-x", markdown: "# 0001 — X\n\nBody.\n" }],
      specSection: "4.2",
      reviewerFindings: { order_issues: [{ hus: [huId], issue: "i", rationale: "r" }] },
      huId,
      acceptanceTests: [{ type: "shell", content: "npx vitest run" }],
    });
    const idxAdr = prompt.indexOf("Architecture Decision Records");
    const idxSpec = prompt.indexOf("SPEC reference");
    const idxRev = prompt.indexOf("Reviewer findings about this HU");
    const idxTests = prompt.indexOf("Acceptance Tests — MUST pass");
    expect(idxAdr).toBeGreaterThan(-1);
    expect(idxSpec).toBeGreaterThan(idxAdr);
    expect(idxRev).toBeGreaterThan(idxSpec);
    expect(idxTests).toBeGreaterThan(idxRev);
  });
});
