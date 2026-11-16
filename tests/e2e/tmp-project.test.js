import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTmpProject, assertUnderTmp } from "./helpers/tmp-project.js";

describe("makeTmpProject cleanup", () => {
  it("removes the project dir and everything registered under kjHome", () => {
    const { projectDir, kjHome, cleanup } = makeTmpProject();
    const session = path.join(kjHome, "sessions", "x", "session.json");
    fs.mkdirSync(path.dirname(session), { recursive: true });
    fs.writeFileSync(session, "{}");
    cleanup();
    expect(fs.existsSync(projectDir)).toBe(false);
    expect(fs.existsSync(kjHome)).toBe(false);
  });
});

describe("assertUnderTmp", () => {
  const tmp = fs.realpathSync(os.tmpdir());

  it.each([
    ["the home directory", os.homedir()],
    ["the filesystem root", path.parse(tmp).root],
    ["a sibling of tmp", `${tmp}-other`],
    ["tmp itself", tmp],
  ])("throws for %s", (_name, dir) => {
    expect(() => assertUnderTmp(dir)).toThrow(/not under the system tmpdir/);
  });

  it("does not throw for a path inside tmp", () => {
    expect(() => assertUnderTmp(path.join(tmp, "kj-e2e-abc"))).not.toThrow();
  });
});
