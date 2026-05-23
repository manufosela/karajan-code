// Tests for the refine loop (KJC-PCS-0048 PR 3).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runRefinePass } from "../../src/spec-review/refine-loop.js";

let tmp;
const noopLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-refine-")); for (const fn of Object.values(noopLog)) fn.mockClear?.(); });
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

const fakeRole = ({ refined, ok = true }) => ({
  async refineSpec() { return ok ? { ok: true, refinedSpec: refined } : { ok: false, error: "agent crashed" }; },
});

describe("runRefinePass", () => {
  it("persists v1 / v2 and reports hashChanged=false when the editor leaves v2 untouched", async () => {
    const refined = "## Spec\n\nRefined and concrete.";
    const res = await runRefinePass({
      spec: "haz algo", findings: [{ severity: "fail", category: "ambiguity", message: "vague" }],
      role: fakeRole({ refined }), projectDir: tmp, logger: noopLog, openEditorFn: () => true,
    });
    expect(res).toMatchObject({ ok: true, hashChanged: false, refinedSpec: refined });

    const sub = (await fs.readdir(path.join(tmp, ".reviews")))[0];
    expect(await fs.readFile(path.join(tmp, ".reviews", sub, "spec-v1.md"), "utf8")).toBe("haz algo");
    expect(await fs.readFile(path.join(tmp, ".reviews", sub, "spec-v2.md"), "utf8")).toBe(refined);
  });

  it("reports hashChanged=true when the editor modifies v2", async () => {
    const res = await runRefinePass({
      spec: "x", findings: [], role: fakeRole({ refined: "v2 initial" }),
      projectDir: tmp, logger: noopLog,
      openEditorFn: async (file) => { await fs.writeFile(file, "v2 EDITED", "utf8"); return true; },
    });
    expect(res.hashChanged).toBe(true);
    expect(res.refinedSpec).toBe("v2 EDITED");
  });

  it("mirrors v2 next to the original --task-file when provided", async () => {
    const taskFile = path.join(tmp, "my-spec.md");
    await fs.writeFile(taskFile, "haz algo", "utf8");
    await runRefinePass({
      spec: "haz algo", findings: [], role: fakeRole({ refined: "rewritten" }),
      projectDir: tmp, taskFile, logger: noopLog, openEditorFn: () => true,
    });
    expect(await fs.readFile(path.join(tmp, "my-spec.v2.md"), "utf8")).toBe("rewritten");
  });

  it("returns ok=false when the role's refineSpec fails", async () => {
    const res = await runRefinePass({
      spec: "x", findings: [], role: fakeRole({ refined: null, ok: false }),
      projectDir: tmp, logger: noopLog, openEditorFn: () => true,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("agent crashed");
  });
});
