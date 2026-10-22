// HU-0014 (ADR 0021, decision 9): relations form a typed graph; a missing
// target or a uses/delegates cycle is an error, and `atril graph` shows it.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { graphErrors } from "../src/graph.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
const artifact = (kind, name, declared = {}, atril = {}) => ({ kind, name, uses: [], delegates: [], related: [], ...declared, atril });

describe("graphErrors", () => {
  it("names the source and the missing target of an author or discovered relation", () => {
    const errors = graphErrors([artifact("command", "ship", { uses: ["skill:ghost"] }, { related: ["agent:gone"] })]);
    expect(errors).toEqual([
      "command:ship uses skill:ghost, which does not exist",
      "command:ship related agent:gone, which does not exist",
    ]);
  });

  it("reports a uses/delegates cycle naming it, and ignores related loops", () => {
    const store = [
      artifact("command", "a", { delegates: ["agent:b"], related: ["skill:c"] }),
      artifact("agent", "b", {}, { uses: ["command:a"] }),
      artifact("skill", "c", { related: ["command:a"] }),
    ];
    expect(graphErrors(store)).toEqual(["cycle in uses/delegates: command:a -> agent:b -> command:a"]);
  });

  it("reports a self-loop", () => {
    expect(graphErrors([artifact("skill", "a", { uses: ["skill:a"] })])).toEqual(["cycle in uses/delegates: skill:a -> skill:a"]);
  });
});

describe("atril graph and enrich --check", () => {
  let dir;
  const write = (path, front) => {
    mkdirSync(dirname(join(dir, ".atril", path)), { recursive: true });
    writeFileSync(join(dir, ".atril", path), `---\n${front}\ndescription: d\n---\nbody\n`);
  };
  const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_ROOT: "", ATRIL_USER_ROOT: join(dir, "none") },
  });
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "atril-graph-")));
    write("skills/tdd/SKILL.md", "name: tdd\nkind: skill");
    write("agents/tester.md", "name: tester\nkind: agent\nuses: [skill:tdd]");
    write("commands/ship.md", "name: ship\nkind: command\ndelegates: [agent:tester]");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("--json prints one artifact's neighbourhood", () => {
    const res = cli("graph", "agent:tester", "--json");
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({
      nodes: [
        { kind: "skill", name: "tdd", path: join(dir, ".atril", "skills", "tdd", "SKILL.md") },
        { kind: "command", name: "ship", path: join(dir, ".atril", "commands", "ship.md") },
        { kind: "agent", name: "tester", path: join(dir, ".atril", "agents", "tester.md") },
      ],
      edges: [
        { from: "command:ship", relation: "delegates", to: "agent:tester" },
        { from: "agent:tester", relation: "uses", to: "skill:tdd" },
      ],
    });
  });

  it("prints the whole graph as text, and fails on an unknown artifact", () => {
    expect(cli("graph").stdout).toBe("command:ship\tdelegates\tagent:tester\nagent:tester\tuses\tskill:tdd\n");
    const res = cli("graph", "skill:nope");
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/skill:nope does not exist/);
  });

  it("graph and enrich --check fail on a graph error", () => {
    write("skills/tdd/SKILL.md", "name: tdd\nkind: skill\nuses: [skill:ghost]");
    for (const args of [["graph"], ["enrich", "--check"]]) {
      const res = cli(...args);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch("skill:tdd uses skill:ghost, which does not exist");
    }
  });

  it("graph and enrich --check accept a relation to the user store", () => {
    write("skills/tdd/SKILL.md", "name: tdd\nkind: skill\nuses: [skill:shared]");
    write("../none/skills/shared/SKILL.md", "name: shared\nkind: skill");
    for (const args of [["graph"], ["enrich", "--check"]]) {
      expect(cli(...args).stderr).not.toMatch("does not exist");
    }
  });

  it("prints the node of an artifact with no edges", () => {
    rmSync(join(dir, ".atril", "agents"), { recursive: true });
    rmSync(join(dir, ".atril", "commands"), { recursive: true });
    expect(cli("graph", "skill:tdd").stdout).toBe("skill:tdd\n");
  });

  it("rejects more than one artifact", () => {
    const res = cli("graph", "agent:tester", "skill:tdd");
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/Usage/);
  });
});
