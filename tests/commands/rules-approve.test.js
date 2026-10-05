// KJC-TSK-0952 (MDR-D3, ADR 0016): kj rules approve — a proposal becomes
// .karajan/rules.yml only by a human act: the agent the rules will watch does
// not decide how they are compiled.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { rulesApprove } from "../../src/commands/rules-approve.js";
import { listRules } from "../../src/rules/inventory.js";

const human = { ppid: 1, cmd: "bash" };
const HUMAN = { env: {}, tty: true, deps: { confirm: (n) => n, ancestry: { pid: 100, readProc: () => human } } };

let dir, home, rules, shown;
const file = (name) => path.join(dir, ".karajan", name);
const entry = (rule, rest = "kind: judgment, when: { tool: Bash }", source = "CLAUDE.md") => `  - { id: ${rule.id}, source: "${source}", text: "${rule.text}", ${rest} }\n`;
const installed = (name) => yaml.load(fs.readFileSync(file(name), "utf8")).rules.map((rule) => rule.id);
const write = (name, entries) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(file(name), `version: 1\nrules:\n${entries.join("")}`);
};
const approve = (over = {}) => rulesApprove({ projectDir: dir, home, log: (line) => shown.push(line), ...HUMAN, ...over });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-approve-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-approve-home-"));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "- Nunca despliegues sin permiso.\n- Siempre responde claro.\n");
  rules = listRules(dir, { home });
  shown = [];
});
afterEach(() => { for (const d of [dir, home]) fs.rmSync(d, { recursive: true, force: true }); });

describe("kj rules approve", () => {
  it("an agent session cannot approve: nothing is installed", () => {
    write("rules.proposed.yml", [entry(rules[0])]);
    expect(() => approve({ env: { CLAUDECODE: "1" } })).toThrow(/kj rules approve es un acto humano/);
    expect(() => approve({ deps: { ...HUMAN.deps, confirm: () => "yes" } })).toThrow(/confirmación humana fallida/);
    expect(fs.existsSync(file("rules.yml"))).toBe(false);
  });

  it("a proposal that does not hold is not offered for approval", () => {
    write("rules.proposed.yml", [`  - { id: ${rules[0].id}, text: "Otra cosa.", kind: judgment, when: { tool: Bash } }\n`]);
    let asked = false;
    const res = approve({ deps: { ...HUMAN.deps, confirm: (n) => { asked = true; return n; } } });
    expect(res.code).toBe(1);
    expect(res.lines.join()).toMatch(/text is not what the MD says/);
    expect(asked).toBe(false);
    expect(fs.existsSync(file("rules.yml"))).toBe(false);
  });

  it("shows every rule, and the ones that leave, before it asks; then installs the proposal as read", () => {
    write("rules.yml", [entry(rules[0]), entry(rules[1])]);
    write("rules.proposed.yml", [entry(rules[0], "kind: out-of-scope, reason: no es una acción")]);
    const confirm = (nonce) => { // the proposal changes while the human reads: what was shown is what lands
      fs.writeFileSync(file("rules.proposed.yml"), "version: 1\nrules: []\n");
      return nonce;
    };
    const res = approve({ deps: { ...HUMAN.deps, confirm } });
    expect(res.code).toBe(0);
    const seen = shown.join("\n");
    expect(seen).toMatch(new RegExp(`${rules[0].id}.*out-of-scope.*Nunca despliegues sin permiso.*no es una acción`, "s"));
    expect(seen).toMatch(new RegExp(`1 rule\\(s\\) LEAVE:\\n${rules[1].id}`));
    expect(yaml.load(fs.readFileSync(file("rules.yml"), "utf8")).rules).toEqual([
      { id: rules[0].id, source: "CLAUDE.md", text: rules[0].text, kind: "out-of-scope", reason: "no es una acción" },
    ]);
    expect(fs.existsSync(file("rules.proposed.yml"))).toBe(false);
  });

  // KJC-TSK-0961 (ADR 0017): what comes from the user's private MD files is not versioned.
  it("installs each rule by where it is written: the project's versioned, the private ones local", () => {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "- Nunca toques otro repo.\n");
    const foreign = listRules(dir, { home }).at(-1);
    write("rules.proposed.yml", [entry(rules[0]), entry(foreign, undefined, "~/.claude/CLAUDE.md")]);
    expect(approve().code).toBe(0);
    expect(installed("rules.yml")).toEqual([rules[0].id]);
    expect(installed("rules.local.yml")).toEqual([foreign.id]);
    expect(shown.join("\n")).toMatch(new RegExp(`${foreign.id}.*not versioned`));
    expect(fs.readFileSync(file("rules.yml"), "utf8")).not.toContain("otro repo");
    // a later proposal with no private rule leaves no stale local file behind
    write("rules.proposed.yml", [entry(rules[0])]);
    expect(approve().code).toBe(0);
    expect(fs.existsSync(file("rules.local.yml"))).toBe(false);
  });
});
