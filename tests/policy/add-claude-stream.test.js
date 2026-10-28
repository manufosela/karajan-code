// KJC-BUG-0430 (issue #2695): with reviewer claude, reviewTask answers with its whole
// stream-json event stream; kj policy add parsed it as YAML and applied nothing.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FRAGMENT = 'roles:\n  coder:\n    write:\n      deny: [".github/workflows/**"]\n      enforcement: deny\n';
const STREAM = [
  JSON.stringify({ type: "system", subtype: "hook_started" }),
  JSON.stringify({ type: "system", subtype: "init" }),
  JSON.stringify({ type: "result", subtype: "success", result: FRAGMENT }),
].join("\n");

vi.mock("../../src/agents/index.js", () => ({
  createAgent: () => ({ reviewTask: async () => ({ ok: true, output: STREAM }) }),
}));
vi.mock("../../src/config/role-resolver.js", () => ({ resolveRole: () => ({ provider: "claude" }) }));

const { policyAddCommand } = await import("../../src/policy/add.js");

let dir;
const cwd0 = process.cwd();
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-poladd-stream-"));
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\n");
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(cwd0);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("kj policy add × claude's stream-json answer", () => {
  it("applies the rule from the final result event, not the raw event stream", async () => {
    const logs = [];
    const code = await policyAddCommand({
      text: "el coder no toca los workflows",
      config: { projectDir: dir },
      flags: { yes: true },
      logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    });
    expect(code, logs.join("\n")).toBe(0);
    expect(fs.readFileSync(path.join(dir, ".karajan", "policy.yml"), "utf8")).toContain(".github/workflows/**");
  });
});
