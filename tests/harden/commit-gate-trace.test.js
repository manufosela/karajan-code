// KJC-TSK-1401 (decided by the maintainer on 2026-11-05): the commit-msg guard
// leaves one line per attempt in .karajan/harness/commit-gate.jsonl, so kj stage
// can open or keep shut its Git gates station. Never the message text.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hookBody } from "../../src/harden/hook-templates.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-commitgate-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (message) => {
  const hook = join(dir, "commit-msg");
  writeFileSync(hook, `#!/bin/sh\n${hookBody("commit-msg", {}, {})}\n`);
  writeFileSync(join(dir, "MSG"), message);
  return spawnSync("sh", [hook, join(dir, "MSG")], { cwd: dir, encoding: "utf8" });
};
const trace = () => readFileSync(join(dir, ".karajan", "harness", "commit-gate.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const OK = "fix(x): something short KJC-TSK-1401";

describe("commit-msg guard trace", () => {
  it("notes an accepted message as a pass, with its time", () => {
    expect(run(`${OK}\n`).status).toBe(0);
    const [line] = trace();
    expect(line).toMatchObject({ outcome: "pass", rule: "ok" });
    expect(Date.parse(line.at)).not.toBeNaN();
  });

  it.each([
    ["header", "not conventional at all\n"],
    ["length", `fix(x): ${"a".repeat(100)}\n`],
    ["body", `${OK}\n\n${"a".repeat(101)}\n`],
  ])("notes a refusal by its rule (%s)", (rule, message) => {
    expect(run(message).status).toBe(1);
    expect(trace()).toEqual([expect.objectContaining({ outcome: "refuse", rule })]);
  });

  it("notes a refusal by the project's commitlint", () => {
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    const bin = join(dir, "node_modules", ".bin", "commitlint");
    writeFileSync(bin, "#!/bin/sh\nexit 1\n");
    chmodSync(bin, 0o755);
    expect(run(`${OK}\n`).status).toBe(1);
    expect(trace()).toEqual([expect.objectContaining({ outcome: "refuse", rule: "commitlint" })]);
  });

  // KJC-BUG-0493: the machine's global commit-msg hook, chained last, refuses too: one line for it.
  it("notes a refusal by the chained global hook", () => {
    const globalDir = join(dir, "global-hooks");
    mkdirSync(globalDir);
    writeFileSync(join(globalDir, "commit-msg"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(globalDir, "commit-msg"), 0o755);
    writeFileSync(join(dir, "gitconfig"), `[core]\n\thooksPath = ${globalDir}\n`);
    const hook = join(dir, "commit-msg");
    writeFileSync(hook, `#!/bin/sh\n${hookBody("commit-msg", {}, {})}\n`);
    writeFileSync(join(dir, "MSG"), `${OK}\n`);
    const res = spawnSync("sh", [hook, join(dir, "MSG")], { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "gitconfig") } });
    expect(res.status).toBe(1);
    expect(trace()).toEqual([expect.objectContaining({ outcome: "refuse", rule: "global-hook" })]);
  });

  it("never writes the message text", () => {
    run("secret-looking words here\n");
    expect(readFileSync(join(dir, ".karajan", "harness", "commit-gate.jsonl"), "utf8")).not.toMatch(/secret/);
  });

  it("does not block a good commit when the trace cannot be written", () => {
    writeFileSync(join(dir, ".karajan"), "a file where the folder should be");
    expect(run(`${OK}\n`).status).toBe(0);
    expect(existsSync(join(dir, ".karajan", "harness"))).toBe(false);
  });
});
