// HU-3533 (KJC-TSK-1445): kj code writes a card with the model of its tier, and with --brief the
// agent that called it gets only the end of the coder's answer, so its own context stays small.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNoopLoggerWithContext } from "../_fixtures/loggers.js";

vi.mock("../../src/agents/index.js", () => ({ createAgent: vi.fn() }));
vi.mock("../../src/agents/availability.js", () => ({ assertAgentsAvailable: vi.fn() }));
vi.mock("../../src/prompts/coder.js", () => ({ buildCoderPrompt: vi.fn(async () => "coder prompt") }));
vi.mock("../../src/commands/rag.js", () => ({ ragQueryCommand: vi.fn(async () => []) }));
vi.mock("../../src/prompts/card-context.js", () => ({ resolveCardContext: vi.fn() }));
vi.mock("../../src/review/retry-findings.js", () => ({
  rejectedReview: vi.fn(async () => ({ reviewer: "codex", count: 1, section: "## The review rejected the previous attempt\n- [high] a.js:1: a is never validated" })),
}));

const { createAgent } = await import("../../src/agents/index.js");
const { buildCoderPrompt } = await import("../../src/prompts/coder.js");
const { resolveCardContext } = await import("../../src/prompts/card-context.js");
const { codeCommand } = await import("../../src/commands/code.js");

let repo;
let printed;
const logger = createNoopLoggerWithContext();
const config = () => ({ projectDir: repo, coder: "claude", roles: { coder: { provider: "claude" } }, development: { methodology: "tdd" } });
const card = (tier) => ({ huId: "HU-9", title: "t", section: "s", acceptanceTests: null, external: false, tier, coderModel: null });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-code-tier-"));
  printed = [];
  vi.spyOn(console, "log").mockImplementation((m) => printed.push(String(m)));
  const output = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
  createAgent.mockReturnValue({ runTask: vi.fn(async () => ({ ok: true, output, exitCode: 0 })) });
});
afterEach(() => { vi.restoreAllMocks(); rmSync(repo, { recursive: true, force: true }); });

describe("kj code --card with a tier", () => {
  it("creates the coder with the model of the card's tier", async () => {
    resolveCardContext.mockResolvedValue(card("trivial"));
    const r = await codeCommand({ task: "t", config: config(), logger, flags: { card: "HU-9" } });
    expect(createAgent.mock.calls.at(-1)[1].roles.coder).toMatchObject({ model: "haiku", effort: "low" });
    expect(r.route).toMatchObject({ model: "haiku" });
  });

  // KJC-BUG-0512 (HU-3551): a config with no projectDir crashed reading the card's board.
  it("reads the card from the directory it runs in when the config carries no projectDir", async () => {
    resolveCardContext.mockResolvedValue(card("trivial"));
    const { projectDir: _none, ...withoutDir } = config();
    await codeCommand({ task: "t", config: withoutDir, logger, flags: { card: "HU-9" } });
    expect(resolveCardContext.mock.calls.at(-1)[0]).toMatchObject({ projectDir: process.cwd(), ref: "HU-9" });
  });

  it("keeps the declared coder model for a card with no tier", async () => {
    resolveCardContext.mockResolvedValue(card(null));
    const r = await codeCommand({ task: "t", config: config(), logger, flags: { card: "HU-9" } });
    expect(createAgent.mock.calls.at(-1)[1].roles.coder.model).toBeUndefined();
    expect(r.route).toBeNull();
  });

  it("with --retry hands the coder the review's findings and climbs to the most capable model", async () => {
    resolveCardContext.mockResolvedValue(card("trivial"));
    const r = await codeCommand({ task: "t", config: config(), logger, flags: { card: "HU-9", retry: true } });
    expect(createAgent.mock.calls.at(-1)[1].roles.coder).toMatchObject({ model: "opus", effort: "max" });
    expect(buildCoderPrompt.mock.calls.at(-1)[0].task).toContain("a is never validated");
    expect(r.route).toMatchObject({ model: "opus" });
  });

  it("with --brief prints only the end of the coder's answer and says how much was left out", async () => {
    resolveCardContext.mockResolvedValue(card("standard"));
    await codeCommand({ task: "t", config: config(), logger, flags: { card: "HU-9", brief: true } });
    const out = printed.join("\n");
    expect(out).toContain("line 50");
    expect(out).not.toMatch(/^line 1$/m);
    expect(out).toMatch(/20 earlier line\(s\) left out/);
  });
});
