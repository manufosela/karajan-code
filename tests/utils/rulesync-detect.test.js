// KJC-BUG-0482 (agreed with atril's maintainer in #2430): a project uses Rulesync when it has
// rulesync.jsonc, rulesync in package.json, or rulesync.generate: true declared. The .rulesync/
// folder alone is atril's shared ground (ADR 0041), so kj writes its blocks into the agent files.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectRulesync } from "../../src/utils/rulesync.js";
import { installPlaybook } from "../../src/environment/playbook.js";

let dir;
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rulesync-detect-"));
  write(".rulesync/rules/atril-router.md", "---\nroot: false\n---\natril's own rule\n"); // what atril leaves
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("detectRulesync", () => {
  it("the .rulesync folder atril creates is not Rulesync", () => {
    expect(detectRulesync(dir)).toBe(false);
  });

  it("the minimal .rulesync atril creates for a plugin (hooks.json, mcp.json, ledger, no rules) is not Rulesync", () => {
    fs.rmSync(path.join(dir, ".rulesync"), { recursive: true });
    for (const file of ["hooks.json", "mcp.json", ".owners.json"]) write(`.rulesync/${file}`, "{}\n");
    expect(detectRulesync(dir)).toBe(false);
  });

  it("rulesync.jsonc is", () => {
    write("rulesync.jsonc", "{}\n");
    expect(detectRulesync(dir)).toBe(true);
  });

  it("rulesync in dependencies or devDependencies is", () => {
    write("package.json", JSON.stringify({ devDependencies: { rulesync: "^1.0.0" } }));
    expect(detectRulesync(dir)).toBe(true);
    write("package.json", JSON.stringify({ dependencies: { rulesync: "^1.0.0" } }));
    expect(detectRulesync(dir)).toBe(true);
    write("package.json", JSON.stringify({ dependencies: { other: "1" } }));
    expect(detectRulesync(dir)).toBe(false);
  });

  it("rulesync.generate: true declared in the project's kj config is", () => {
    write(".karajan/kj.config.yml", "rulesync:\n  generate: true\n");
    expect(detectRulesync(dir)).toBe(true);
    write(".karajan/kj.config.yml", "rulesync:\n  generate: false\n");
    expect(detectRulesync(dir)).toBe(false);
    write(".karajan/atril.json", JSON.stringify({ rulesync: { generate: true } }));
    expect(detectRulesync(dir)).toBe(true); // atril's config is the other place that declares it
  });

  it("with only atril's .rulesync, the method block lands in CLAUDE.md, AGENTS.md and GEMINI.md", async () => {
    await installPlaybook({ projectDir: dir, target: "all" });
    for (const file of ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]) {
      expect(fs.readFileSync(path.join(dir, file), "utf8"), file).toMatch(/kj:managed:playbook/);
    }
    expect(fs.existsSync(path.join(dir, ".rulesync", "rules", "karajan.md"))).toBe(false);
  });
});
