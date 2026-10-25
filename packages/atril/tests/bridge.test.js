// ADR 0021, decision 10 and plan step 8: atril's persistent pieces are one bridge
// command and one router rule, plus the artifacts the user exposes on purpose.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MARKER, expose, persistentPieces, unexpose } from "../src/bridge.js";
import { readConfig, writeConfig } from "../src/config.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-bridge-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const write = (rel, text) => {
  const file = join(dir, "store", rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const artifact = (rel, kind, name) => write(rel, `---\nname: ${name}\ndescription: d\nkind: ${kind}\n---\nbody of ${name}\n`);
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") });
const run = (...args) => spawnSync(process.execPath, [BIN, ...args, "--root", "store"], { cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_USER_ROOT: join(dir, "nu") } });

describe("persistent pieces", () => {
  it("are the bridge command and the router rule, each with atril's marker, when nothing is exposed", () => {
    const pieces = persistentPieces(o());
    expect(pieces.map((p) => p.path)).toEqual(["commands/atril.md", "rules/atril-router.md"]);
    for (const { content } of pieces) {
      expect(content.startsWith("---\n")).toBe(true);
      expect(content).toContain(MARKER);
      expect(content).toContain("atril route");
    }
  });

  it("add each exposed artifact where rulesync reads its kind, the marker after its frontmatter", () => {
    artifact("skills/tdd/SKILL.md", "skill", "tdd");
    write("skills/tdd/refs/notes.md", "notes");
    artifact("commands/review.md", "command", "review");
    artifact("agents/tester.md", "agent", "tester");
    write("agents/win.md", "---\r\nname: win\r\ndescription: d\r\nkind: agent\r\n---\r\nbody\r\n");
    expose(["skill:tdd", "command:review", "agent:tester", "agent:win"], o());
    const byPath = Object.fromEntries(persistentPieces(o()).map((p) => [p.path, p.content]));
    expect(Object.keys(byPath)).toEqual(expect.arrayContaining(["skills/tdd/SKILL.md", "skills/tdd/refs/notes.md", "commands/review.md", "subagents/tester.md"]));
    expect(byPath["commands/review.md"]).toMatch(/^---\nname: review\n[\s\S]*---\n<!-- atril:managed -->\nbody of review/);
    expect(byPath["skills/tdd/refs/notes.md"]).toBe("notes");
    expect(byPath["subagents/win.md"]).toBe("---\r\nname: win\r\ndescription: d\r\nkind: agent\r\n---\r\n<!-- atril:managed -->\r\nbody\r\n");
  });
});

describe("expose / unexpose", () => {
  it("record the choice in atril.json, idempotently, and take it back", () => {
    artifact("commands/review.md", "command", "review");
    expect(expose(["command:review"], o())).toEqual(["command:review"]);
    expose(["command:review"], o());
    expect(readConfig(o()).expose.command).toEqual(["review"]);
    expect(unexpose(["command:review"], o())).toEqual(["command:review"]);
    expect(readConfig(o()).expose.command).toEqual([]);
  });

  it("refuse an artifact the store does not hold, a malformed reference, and the bridge's own name", () => {
    expect(() => expose(["skill:ghost"], o())).toThrow(/skill:ghost is not in the store/);
    expect(() => expose(["review"], o())).toThrow(/kind:name/);
    artifact("commands/atril.md", "command", "atril");
    expect(() => expose(["command:atril"], o())).toThrow(/reserved for the bridge/);
    writeConfig({ expose: { command: ["atril"] } }, o());
    expect(() => persistentPieces(o())).toThrow(/reserved for the bridge: atril unexpose command:atril/);
    expect(unexpose(["command:atril", "skill:ghost"], o())).toEqual(["command:atril", "skill:ghost"]);
  });

  it("run from the CLI", () => {
    artifact("agents/tester.md", "agent", "tester");
    expect(run("expose", "agent:tester").stdout.trim()).toBe("exposed\tagent:tester");
    expect(run("unexpose", "agent:tester").stdout.trim()).toBe("unexposed\tagent:tester");
  });
});
