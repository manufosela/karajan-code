// KJC-TSK-0845 — the collector over a tree: one key, two resolution rules in
// two modules = a migration left half-way (KJ_HOME → KARAJAN_HOME reached the
// runtime, not the installer). It says WHERE and HOW each side resolves it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectEnvKeyFindings, groupEnvKeyFindingsBySeverity } from "../../src/audit/env-key-findings.js";

describe("collectEnvKeyFindings", () => {
  let dir;
  const write = (rel, text) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); };
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "kj-envkeys-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("reports a key resolved with different rules in different files, with every site", async () => {
    write("src/paths.js", 'export const home = process.env.KARAJAN_HOME || process.env.KJ_HOME || join(homedir(), ".karajan");\n');
    write("scripts/install.js", 'const home = process.env.KARAJAN_HOME || path.join(os.homedir(), ".karajan");\n');
    write("src/consumer.js", "const h = process.env.KARAJAN_HOME;\nif (!h) throw new Error();\n");
    const r = await collectEnvKeyFindings(dir);
    expect(r).toMatchObject({ available: true, scanned: 3, incomplete: [] });
    expect(r.divergent).toEqual([{
      key: "KARAJAN_HOME", kind: "env",
      rules: [
        { rule: 'KARAJAN_HOME || process.env.KJ_HOME || join(homedir(),".karajan")', sites: ["src/paths.js:1"] },
        { rule: 'KARAJAN_HOME || path.join(os.homedir(),".karajan")', sites: ["scripts/install.js:1"] },
      ],
    }]);
  });

  it("a file that reads the deprecated key without naming its successor is an incomplete migration", async () => {
    // A comment naming the successor is not a migration: only a READ of it is.
    write("scripts/install.js", '// TODO move to KARAJAN_HOME\nconst home = process.env.KJ_HOME || path.join(os.homedir(), ".karajan");\n');
    write("src/paths.js", "const home = process.env.KARAJAN_HOME || process.env.KJ_HOME || d();\n");
    write("src/legacy.js", "if (process.env.KARAJAN_HOME) migrate();\nconst old = process.env.KJ_HOME;\n");
    const r = await collectEnvKeyFindings(dir);
    expect(r.incomplete).toEqual([{ key: "KJ_HOME", successor: "KARAJAN_HOME", file: "scripts/install.js", line: 2 }]);
    expect(groupEnvKeyFindingsBySeverity(r)).toMatchObject({ HIGH: r.incomplete, MEDIUM: r.divergent });
  });

  it("the same rule in two files, or two rules in ONE file, is not divergence; config paths count like env keys", async () => {
    write("src/a.js", 'const b = config.base_branch || "main";\n');
    write("src/b.js", 'const b = config?.base_branch || "main";\n');
    write("src/c.js", 'const x = config.a.b || "x";\nconst y = config.a.b || "y";\n');
    write("src/d.js", 'const x = config.a.b || "z";\n');
    write("src/e.js", 'const p = config.port ?? "1";\n');
    write("src/f.js", 'const p = config.port || "1";\n'); // same default, different operator: divergent
    write("src/g.js", 'const p = process.env.PORT || "1";\n'); // env PORT vs config.port: different subjects
    write("src/h.js", 'const p = process.env.PORT || "1";\n');
    const r = await collectEnvKeyFindings(dir);
    expect(r.divergent.map((d) => `${d.kind}:${d.key}`)).toEqual(["config:a.b", "config:port"]);
  });

  it("skips tests, node_modules and dist", async () => {
    write("src/a.js", 'const p = process.env.KJ_PORT || "1";\n');
    write("tests/a.test.js", 'const p = process.env.KJ_PORT || "2";\n');
    write("src/node_modules/x/i.js", 'const p = process.env.KJ_PORT || "3";\n');
    expect((await collectEnvKeyFindings(dir)).divergent).toEqual([]);
  });
});
