// HU-2716 (ADR 0021, decisions 9 and 12, plan step 10b): status says, per artifact, whether it
// is what was installed, was edited by hand, is gone, or came from outside the catalogs.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfig } from "../src/config.js";
import { status } from "../src/index.js";
import { recordInstall, recordPlugin } from "../src/lock.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-status-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") });
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
  return join(dir, rel);
};
const command = (name, body = "body", extra = "") => put(`store/commands/${name}.md`, `---\nname: ${name}\ndescription: d\nkind: command\n${extra}---\n${body}\n`);
const record = (kind, name, path, origin = { origin: "catalog", catalog: "atril:recommended" }) => recordInstall({ kind, name, path }, origin, o());
const states = () => Object.fromEntries(status(o()).map(({ kind, name, state }) => [`${kind}:${name}`, state]));

describe("status", () => {
  it("is empty for an empty store", () => {
    expect(status(o())).toEqual([]);
  });

  it("is ok for an artifact that matches its lock entry, and gives the origin without the hash", () => {
    record("command", "deploy", command("deploy"));
    expect(status(o())).toEqual([{ kind: "command", name: "deploy", state: "ok", origin: { origin: "catalog", catalog: "atril:recommended" } }]);
  });

  it("reports a plugin artifact with its plugin: ok while the lock holds the plugin, uncurated when it does not", () => {
    record("command", "kit__ship", command("kit__ship"), { origin: "plugin", plugin: "kit" });
    expect(status(o())[0]).toMatchObject({ state: "uncurated", origin: { origin: "plugin", plugin: "kit" } });
    recordPlugin("kit", { entries: ["command:kit__ship"] }, o());
    expect(states()).toEqual({ "command:kit__ship": "ok" });
  });

  it("is edited when the body changes, but not when only the atril: block does", () => {
    record("command", "deploy", command("deploy"));
    record("command", "lint", command("lint"));
    command("deploy", "changed");
    command("lint", "body", "atril:\n  tags: [x]\n");
    expect(states()).toEqual({ "command:deploy": "edited", "command:lint": "ok" });
  });

  it("is edited when a script of a skill folder changes", () => {
    const skill = put("store/skills/tdd/SKILL.md", "---\nname: tdd\ndescription: d\nkind: skill\n---\nbody\n");
    record("skill", "tdd", dirname(skill));
    put("store/skills/tdd/run.sh", "echo hi");
    expect(states()).toEqual({ "skill:tdd": "edited" });
  });

  it("is missing when the lock records an artifact that is gone", () => {
    record("command", "deploy", command("deploy"));
    rmSync(join(dir, "store/commands/deploy.md"));
    expect(status(o())).toEqual([{ kind: "command", name: "deploy", state: "missing", origin: { origin: "catalog", catalog: "atril:recommended" } }]);
  });

  it("is uncurated with no origin when there is no lock entry", () => {
    command("deploy");
    expect(status(o())).toEqual([{ kind: "command", name: "deploy", state: "uncurated", origin: null }]);
    expect(existsSync(join(dir, "store/atril.lock.json"))).toBe(false);
  });

  it("is uncurated for a local or imported install, and for a catalog that is no longer configured", () => {
    record("command", "a", command("a"), { origin: "local" });
    record("command", "b", command("b"), { origin: "import", from: "openskills" });
    record("command", "c", command("c"), { origin: "catalog", catalog: "kit" });
    expect(states()).toEqual({ "command:a": "uncurated", "command:b": "uncurated", "command:c": "uncurated" });
  });

  it("is ok for a catalog that is configured, and for a source that its sources catalog still lists", () => {
    put("kit/commands/x.md", "---\nname: x\ndescription: d\nkind: command\n---\nbody\n");
    put("pins.json", JSON.stringify({ sources: [{ source: "acme/tools", commit: "a".repeat(40), note: "n" }] }));
    writeConfig({ catalogs: ["kit", "pins.json"] }, o());
    record("command", "a", command("a"), { origin: "catalog", catalog: "kit" });
    record("command", "b", command("b"), { origin: "catalog", catalog: "pins.json", source: "acme/tools", commit: "b".repeat(40) });
    record("command", "c", command("c"), { origin: "catalog", catalog: "pins.json", source: "acme/gone", commit: "b".repeat(40) });
    expect(states()).toEqual({ "command:a": "ok", "command:b": "ok", "command:c": "uncurated" });
  });

  it("gives missing precedence over uncurated", () => {
    record("command", "deploy", command("deploy"), { origin: "local" });
    rmSync(join(dir, "store/commands/deploy.md"));
    expect(status(o())).toEqual([{ kind: "command", name: "deploy", state: "missing", origin: { origin: "local" } }]);
  });

  it("does not report the user-level store", () => {
    put("user/commands/mine.md", "---\nname: mine\ndescription: d\nkind: command\n---\nbody\n");
    expect(status({ ...o(), userRoot: join(dir, "user") })).toEqual([]);
  });

  it("gives edited precedence over uncurated, and keeps the origin", () => {
    record("command", "deploy", command("deploy"), { origin: "local" });
    command("deploy", "changed");
    expect(status(o())).toEqual([{ kind: "command", name: "deploy", state: "edited", origin: { origin: "local" } }]);
  });

  it("sorts by kind:name", () => {
    command("b");
    command("a_x");
    command("a-x");
    put("store/agents/z.md", "---\nname: z\ndescription: d\nkind: agent\n---\nbody\n");
    // "-" (45) is before "_" (95) in code units; a locale collation puts "_" first.
    expect(status(o()).map(({ kind, name }) => `${kind}:${name}`)).toEqual(["agent:z", "command:a-x", "command:a_x", "command:b"]);
  });

  it("fails loudly on a broken lock", () => {
    put("store/atril.lock.json", "{");
    expect(() => status(o())).toThrow(/invalid JSON/);
  });
});
