import { describe, it, expect } from "vitest";
import { buildArchitectPrompt, parseArchitectOutput, VALID_VERDICTS } from "../src/prompts/architect.js";

describe("buildArchitectPrompt", () => {
  it("returns a string containing the task", async () => {
    const prompt = await buildArchitectPrompt({ task: "Design auth system" });
    expect(prompt).toContain("Design auth system");
  });

  it("includes sub-agent preamble", async () => {
    const prompt = await buildArchitectPrompt({ task: "x" });
    expect(prompt).toContain("Karajan sub-agent");
    expect(prompt).toContain("Do NOT use any MCP tools");
  });

  it("includes instructions when provided", async () => {
    const prompt = await buildArchitectPrompt({ task: "x", instructions: "Custom architect instructions" });
    expect(prompt).toContain("Custom architect instructions");
  });

  it("omits instructions section when null", async () => {
    const prompt = await buildArchitectPrompt({ task: "x", instructions: null });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes JSON schema with architecture fields", async () => {
    const prompt = await buildArchitectPrompt({ task: "x" });
    expect(prompt).toContain("verdict");
    expect(prompt).toContain("architecture");
    expect(prompt).toContain("layers");
    expect(prompt).toContain("patterns");
    expect(prompt).toContain("dataModel");
    expect(prompt).toContain("apiContracts");
    expect(prompt).toContain("dependencies");
    expect(prompt).toContain("tradeoffs");
    expect(prompt).toContain("questions");
    expect(prompt).toContain("summary");
  });

  it("includes research context when provided", async () => {
    const prompt = await buildArchitectPrompt({ task: "x", researchContext: "Files: src/auth.js" });
    expect(prompt).toContain("Files: src/auth.js");
  });

  it("omits research context section when not provided", async () => {
    const prompt = await buildArchitectPrompt({ task: "x" });
    expect(prompt).not.toContain("## Research Context");
  });

  it("includes architecture role description", async () => {
    const prompt = await buildArchitectPrompt({ task: "x" });
    expect(prompt).toContain("architect");
  });
});

describe("VALID_VERDICTS", () => {
  it("includes ready", async () => {
    expect(VALID_VERDICTS).toContain("ready");
  });

  it("includes needs_clarification", async () => {
    expect(VALID_VERDICTS).toContain("needs_clarification");
  });
});

describe("parseArchitectOutput", () => {
  const validOutput = {
    verdict: "ready",
    architecture: {
      type: "layered",
      layers: ["presentation", "business", "data"],
      patterns: ["repository", "factory"],
      dataModel: { entities: ["User", "Session"] },
      apiContracts: ["POST /auth/login", "GET /auth/me"],
      dependencies: ["bcrypt", "jsonwebtoken"],
      tradeoffs: ["JWT vs session cookies"]
    },
    questions: [],
    summary: "Well-defined auth architecture"
  };

  it("parses valid JSON output", async () => {
    const parsed = parseArchitectOutput(JSON.stringify(validOutput));
    expect(parsed).not.toBeNull();
    expect(parsed.verdict).toBe("ready");
    expect(parsed.architecture.type).toBe("layered");
    expect(parsed.architecture.layers).toEqual(["presentation", "business", "data"]);
    expect(parsed.architecture.patterns).toEqual(["repository", "factory"]);
    expect(parsed.architecture.dataModel.entities).toEqual(["User", "Session"]);
    expect(parsed.architecture.apiContracts).toEqual(["POST /auth/login", "GET /auth/me"]);
    expect(parsed.architecture.dependencies).toEqual(["bcrypt", "jsonwebtoken"]);
    expect(parsed.architecture.tradeoffs).toEqual(["JWT vs session cookies"]);
    expect(parsed.questions).toEqual([]);
    expect(parsed.summary).toBe("Well-defined auth architecture");
  });

  it("parses JSON embedded in markdown code blocks", async () => {
    const raw = `Here is my analysis:\n\`\`\`json\n${JSON.stringify(validOutput)}\n\`\`\`\nDone.`;
    const parsed = parseArchitectOutput(raw);
    expect(parsed).not.toBeNull();
    expect(parsed.verdict).toBe("ready");
    expect(parsed.architecture.type).toBe("layered");
  });

  it("returns null for non-JSON output", async () => {
    expect(parseArchitectOutput("no json here")).toBeNull();
  });

  it("returns null for empty/null input", async () => {
    expect(parseArchitectOutput("")).toBeNull();
    expect(parseArchitectOutput(null)).toBeNull();
    expect(parseArchitectOutput(undefined)).toBeNull();
  });

  it("returns null for invalid JSON", async () => {
    expect(parseArchitectOutput("{invalid json}")).toBeNull();
  });

  it("normalizes verdict to valid values", async () => {
    const raw = JSON.stringify({ ...validOutput, verdict: "ready" });
    const parsed = parseArchitectOutput(raw);
    expect(VALID_VERDICTS).toContain(parsed.verdict);
  });

  it("defaults invalid verdict to needs_clarification", async () => {
    const raw = JSON.stringify({ ...validOutput, verdict: "unknown_verdict" });
    const parsed = parseArchitectOutput(raw);
    expect(parsed.verdict).toBe("needs_clarification");
  });

  it("defaults missing architecture to empty structure", async () => {
    const raw = JSON.stringify({ verdict: "ready", questions: [], summary: "ok" });
    const parsed = parseArchitectOutput(raw);
    expect(parsed.architecture.type).toBe("");
    expect(parsed.architecture.layers).toEqual([]);
    expect(parsed.architecture.patterns).toEqual([]);
    expect(parsed.architecture.dataModel.entities).toEqual([]);
    expect(parsed.architecture.apiContracts).toEqual([]);
    expect(parsed.architecture.dependencies).toEqual([]);
    expect(parsed.architecture.tradeoffs).toEqual([]);
  });

  it("defaults missing questions to empty array", async () => {
    const raw = JSON.stringify({ verdict: "ready", architecture: validOutput.architecture, summary: "ok" });
    const parsed = parseArchitectOutput(raw);
    expect(parsed.questions).toEqual([]);
  });

  it("defaults missing summary to empty string", async () => {
    const raw = JSON.stringify({ verdict: "ready", architecture: validOutput.architecture, questions: [] });
    const parsed = parseArchitectOutput(raw);
    expect(parsed.summary).toBe("");
  });

  it("filters non-string items from arrays", async () => {
    const raw = JSON.stringify({
      verdict: "ready",
      architecture: {
        type: "layered",
        layers: ["presentation", 123, null, "data"],
        patterns: ["factory", undefined],
        dataModel: { entities: ["User", 42] },
        apiContracts: ["GET /api", false],
        dependencies: ["express", {}],
        tradeoffs: ["speed vs safety", []]
      },
      questions: ["Is this right?", 5],
      summary: "ok"
    });
    const parsed = parseArchitectOutput(raw);
    expect(parsed.architecture.layers).toEqual(["presentation", "data"]);
    expect(parsed.architecture.patterns).toEqual(["factory"]);
    expect(parsed.architecture.dataModel.entities).toEqual(["User"]);
    expect(parsed.architecture.apiContracts).toEqual(["GET /api"]);
    expect(parsed.architecture.dependencies).toEqual(["express"]);
    expect(parsed.architecture.tradeoffs).toEqual(["speed vs safety"]);
    expect(parsed.questions).toEqual(["Is this right?"]);
  });

  it("parses needs_clarification verdict with questions", async () => {
    const raw = JSON.stringify({
      verdict: "needs_clarification",
      architecture: validOutput.architecture,
      questions: ["Which auth provider to use?", "Should we support OAuth?"],
      summary: "Missing auth provider decision"
    });
    const parsed = parseArchitectOutput(raw);
    expect(parsed.verdict).toBe("needs_clarification");
    expect(parsed.questions).toHaveLength(2);
    expect(parsed.questions[0]).toBe("Which auth provider to use?");
  });

  it("handles architecture with partial fields", async () => {
    const raw = JSON.stringify({
      verdict: "ready",
      architecture: { type: "microservices", layers: ["api"] },
      questions: [],
      summary: "ok"
    });
    const parsed = parseArchitectOutput(raw);
    expect(parsed.architecture.type).toBe("microservices");
    expect(parsed.architecture.layers).toEqual(["api"]);
    expect(parsed.architecture.patterns).toEqual([]);
    expect(parsed.architecture.dataModel.entities).toEqual([]);
  });

  it("handles dataModel without entities", async () => {
    const raw = JSON.stringify({
      verdict: "ready",
      architecture: { type: "x", dataModel: {} },
      questions: [],
      summary: "ok"
    });
    const parsed = parseArchitectOutput(raw);
    expect(parsed.architecture.dataModel.entities).toEqual([]);
  });
});
