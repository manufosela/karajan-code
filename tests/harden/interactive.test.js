import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decideAction, interactiveHarden } from "../../src/harden/interactive.js";

let root;
const logger = { info: vi.fn() };
const read = (rel) => readFileSync(join(root, rel), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), "kj-interactive-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("decideAction", () => {
  it("defaults to adding a missing artifact and to keeping a user's own", () => {
    expect(decideAction({ recommendation: "install", file: "x", rationale: "r" })).toMatchObject({ action: "add", defaultYes: true });
    expect(decideAction({ recommendation: "review", file: "x", improvements: [{}, {}] })).toMatchObject({ action: "adopt", defaultYes: false });
    expect(decideAction({ recommendation: "keep" })).toBeNull();
  });
});

describe("interactiveHarden", () => {
  it("adds missing configs and adopts a thin user config when the user says yes", async () => {
    writeFileSync(join(root, "commitlint.config.js"), "export default { rules: {} };"); // thin USER_OWNED
    const ask = vi.fn().mockResolvedValue(true);
    const res = await interactiveHarden({ projectDir: root, ask, logger });
    expect(res.applied.some((a) => a.file === ".editorconfig" && a.action === "add")).toBe(true);
    expect(res.applied.some((a) => a.file === "commitlint.config.js" && a.action === "adopt")).toBe(true);
    expect(read("commitlint.config.js")).toContain("kj:managed:commitlint");
    expect(read("commitlint.config.js")).toContain("header-max-length");
  });

  it("writes nothing the user declines (safe default)", async () => {
    writeFileSync(join(root, "commitlint.config.js"), "export default { rules: {} };");
    const ask = vi.fn().mockResolvedValue(false);
    const res = await interactiveHarden({ projectDir: root, ask, logger });
    expect(res.applied).toEqual([]);
    expect(existsSync(join(root, ".editorconfig"))).toBe(false);
    expect(read("commitlint.config.js")).toBe("export default { rules: {} };"); // untouched
  });
});
