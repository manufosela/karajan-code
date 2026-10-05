// KJC-TSK-0969 (MDR-G, ADR 0016): kj rules decide — a real project has more than a
// hundred rules, and most take no condition. Their kind is decided in one go;
// a deterministic rule, with its condition and examples, is still written by hand.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { rulesDecide } from "../../src/commands/rules-decide.js";

let dir, file;
const entries = () => yaml.load(fs.readFileSync(file, "utf8")).rules;
const decide = (opts) => rulesDecide({ projectDir: dir, ...opts });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-decide-"));
  file = path.join(dir, ".karajan", "rules.proposed.yml");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump({ version: 1, rules: ["R-aaaaaaaaa1", "R-aaaaaaaaa2", "R-aaaaaaaaa3"].map((id) => ({ id, source: "CLAUDE.md", text: `Regla ${id}.` })) }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("kj rules decide", () => {
  it("marks several rules as judgment with their tool, and leaves the rest alone", () => {
    const res = decide({ ids: ["R-aaaaaaaaa1", "R-aaaaaaaaa3"], kind: "judgment", tools: ["Edit", "Write"] });
    expect(res.code).toBe(0);
    expect(res.lines.join()).toMatch(/2 rule\(s\) decided.*1 .*no kind/);
    expect(entries()).toEqual([
      { id: "R-aaaaaaaaa1", source: "CLAUDE.md", text: "Regla R-aaaaaaaaa1.", kind: "judgment", when: { tool: ["Edit", "Write"] } },
      { id: "R-aaaaaaaaa2", source: "CLAUDE.md", text: "Regla R-aaaaaaaaa2." },
      { id: "R-aaaaaaaaa3", source: "CLAUDE.md", text: "Regla R-aaaaaaaaa3.", kind: "judgment", when: { tool: ["Edit", "Write"] } },
    ]);
    decide({ ids: ["R-aaaaaaaaa2"], kind: "judgment", tools: ["Bash"] });
    expect(entries()[1].when).toEqual({ tool: "Bash" });
  });

  it("marks rules out of scope with the reason, and a rule decided again drops what its old kind took", () => {
    decide({ ids: ["R-aaaaaaaaa1"], kind: "judgment", tools: ["Bash"] });
    expect(decide({ ids: ["R-aaaaaaaaa1", "R-aaaaaaaaa2"], kind: "out-of-scope", reason: "trata de cómo respondo" }).code).toBe(0);
    expect(entries()[0]).toEqual({ id: "R-aaaaaaaaa1", source: "CLAUDE.md", text: "Regla R-aaaaaaaaa1.", kind: "out-of-scope", reason: "trata de cómo respondo" });
    expect(entries()[1]).toMatchObject({ kind: "out-of-scope", reason: "trata de cómo respondo" });
  });

  // KJC-TSK-0973: why a rule takes no condition is said, for the reviewer and the human.
  it("a judgment rule keeps the reason it is given, and none when there is none", () => {
    decide({ ids: ["R-aaaaaaaaa1"], kind: "judgment", tools: ["Bash"], reason: " lo que la rompe está en el fichero del mensaje " });
    expect(entries()[0]).toMatchObject({ kind: "judgment", when: { tool: "Bash" }, reason: "lo que la rompe está en el fichero del mensaje" });
    decide({ ids: ["R-aaaaaaaaa1"], kind: "judgment", tools: ["Bash"] });
    expect(entries()[0]).not.toHaveProperty("reason");
  });

  it("writes nothing when an id is not in the proposal or the kind lacks what it takes", () => {
    const before = fs.readFileSync(file, "utf8");
    const bad = [
      [{ ids: ["R-aaaaaaaaa1", "R-zzzzzzzzzz"], kind: "judgment", tools: ["Bash"] }, /not in.*R-zzzzzzzzzz/],
      [{ ids: ["R-aaaaaaaaa1"], kind: "judgment", tools: [] }, /--tool/],
      [{ ids: ["R-aaaaaaaaa1"], kind: "out-of-scope", reason: "  " }, /--reason/],
      [{ ids: [], kind: "judgment", tools: ["Bash"] }, /at least one rule id/],
      [{ ids: ["R-aaaaaaaaa1"], kind: "deterministic" }, /by hand/],
    ];
    for (const [opts, why] of bad) {
      const res = decide(opts);
      expect(res.code).toBe(1);
      expect(res.lines.join()).toMatch(why);
    }
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    fs.rmSync(file);
    expect(decide({ ids: ["R-aaaaaaaaa1"], kind: "judgment", tools: ["Bash"] }).lines.join()).toMatch(/kj rules compile/);
  });
});
