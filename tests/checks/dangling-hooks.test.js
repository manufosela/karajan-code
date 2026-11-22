// HU-4779: a hook that runs a .karajan/harness file that is gone crashes node on every tool call;
// kj doctor says so instead of "All checks passed".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDanglingHookChecks } from "../../src/checks/dangling-hooks.js";

const COMMAND = "node .karajan/harness/posttooluse.mjs";
let dir;

const writeSettings = () => {
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const settings = { hooks: { PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: COMMAND }] }] } };
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify(settings));
};
const detect = () => getDanglingHookChecks({ projectDir: dir })[0].detect();

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-dangling-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the dangling-hooks check", () => {
  it("is a manual check with its own name", () => {
    const [check] = getDanglingHookChecks({ projectDir: dir });
    expect(check.name).toBe("dangling-hooks");
    expect(check.label).toBe("Hooks that run a missing harness file");
  });

  it("passes when the project has no settings", async () => {
    expect(await detect()).toMatchObject({ ok: true, severity: "info" });
  });

  it("fails naming the file, the event and the command when the harness file is absent", async () => {
    writeSettings();
    const result = await detect();
    expect(result).toMatchObject({ ok: false, severity: "fail" });
    expect(result.detail).toContain(`.claude/settings.json PostToolUse → ${COMMAND}`);
    expect(result.fix).toContain("kj harden");
  });

  it("passes when the harness file exists", async () => {
    writeSettings();
    fs.mkdirSync(path.join(dir, ".karajan", "harness"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "harness", "posttooluse.mjs"), "");
    expect((await detect()).ok).toBe(true);
  });
});
