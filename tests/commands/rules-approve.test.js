// KJC-TSK-0952 (MDR-D3, ADR 0016): kj rules approve — a proposal becomes
// .karajan/rules.yml only by a human act: the agent the rules will watch does
// not decide how they are compiled.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { rulesApprove } from "../../src/commands/rules-approve.js";
import { listRules } from "../../src/rules/inventory.js";
import { saveVerdict } from "../../src/review/verdict-store.js";

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
/** A proposal a different AI already approved, as `kj rules review` leaves it. */
const propose = async (entries, verdict = "approved") => {
  write("rules.proposed.yml", entries);
  await saveVerdict(dir, fs.readFileSync(file("rules.proposed.yml"), "utf8"), { verdict, reviewer: "codex", issues: [{ description: "R-x: demasiado estrecha" }], summary: "fiel" });
};
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-approve-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-approve-home-"));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "- Nunca despliegues sin permiso.\n- Siempre responde claro.\n");
  rules = listRules(dir, { home });
  shown = [];
});
afterEach(() => { for (const d of [dir, home]) fs.rmSync(d, { recursive: true, force: true }); });

describe("kj rules approve", () => {
  it("an agent session cannot approve: nothing is installed", async () => {
    await propose([entry(rules[0])]);
    await expect(approve({ env: { CLAUDECODE: "1" } })).rejects.toThrow(/kj rules approve es un acto humano/);
    await expect(approve({ deps: { ...HUMAN.deps, confirm: () => "yes" } })).rejects.toThrow(/confirmación humana fallida/);
    expect(fs.existsSync(file("rules.yml"))).toBe(false);
  });

  // KJC-TSK-0998 (HUM-D, ADR 0018): the phone signs the exact YAML that lands; at max with no phone, no approval.
  it("at max the phone signs the sha256 of the rules.yml that lands, and sees the rules; with no phone nothing is installed", async () => {
    await propose([entry(rules[0])]);
    fs.writeFileSync(file("security-level.json"), JSON.stringify({ level: "max", since: "2026-10-09" }));
    await expect(approve({ deps: { ...HUMAN.deps, phone: { enrolled: () => false } } })).rejects.toThrow(/kj rules approve: con seguridad máxima.*kj identity enroll-phone/);
    expect(fs.existsSync(file("rules.yml"))).toBe(false);
    let asked;
    const phone = { enrolled: () => true, request: async (req) => { asked = req; return { ok: true }; } };
    expect((await approve({ deps: { ...HUMAN.deps, phone } })).code).toBe(0);
    const sha = (text) => createHash("sha256").update(text).digest("hex");
    expect(asked.files).toEqual([{ file: ".karajan/rules.yml", sha256: sha(fs.readFileSync(file("rules.yml"), "utf8")) }, { file: ".karajan/rules.local.yml", sha256: "" }]);
    expect(asked.changes[0]).toMatchObject({ file: ".karajan/rules.yml", status: "new", summary: "1 rule(s)", diff: expect.stringContaining(rules[0].id) });
    expect(asked.why).toMatch(/^Qué se va a hacer: Se instalan las reglas/);
  });

  it("a proposal that does not hold is not offered for approval", async () => {
    await propose([`  - { id: ${rules[0].id}, text: "Otra cosa.", kind: judgment, when: { tool: Bash } }\n`]);
    let asked = false;
    const res = await approve({ deps: { ...HUMAN.deps, confirm: (n) => { asked = true; return n; } } });
    expect(res.code).toBe(1);
    expect(res.lines.join()).toMatch(/text is not what the MD says/);
    expect(asked).toBe(false);
    expect(fs.existsSync(file("rules.yml"))).toBe(false);
  });

  // KJC-TSK-0963 (ADR 0017): whoever wrote the proposal does not call it good.
  it("with no review of these exact bytes by a different AI, it is not offered", async () => {
    let asked = false;
    const deps = { ...HUMAN.deps, confirm: (n) => { asked = true; return n; } };
    write("rules.proposed.yml", [entry(rules[0])]); // never reviewed
    expect(await approve({ deps })).toMatchObject({ code: 1, lines: [expect.stringMatching(/no cross-AI review of its exact content.*kj rules review/)] });
    await propose([entry(rules[0])]);
    fs.appendFileSync(file("rules.proposed.yml"), entry(rules[1])); // touched after the review
    expect((await approve({ deps })).code).toBe(1);
    expect(asked).toBe(false);
    expect(fs.existsSync(file("rules.yml"))).toBe(false);
  });

  // KJC-TSK-0974 (ADR 0017, adjusted 2026-10-06): a rejection does not decide. The
  // reviewer never converged on shell text (twelve passes, one more case each);
  // the defense is that nothing is approved unseen, so the objections come first.
  it("a rejected review is offered, its objections before anything else, and the human decides", async () => {
    await propose([entry(rules[0])], "rejected");
    const res = await approve();
    expect(res.code).toBe(0);
    expect(shown[0]).toMatch(/REJECTED by codex, a different AI/);
    const objection = shown.findIndex((line) => line.includes("demasiado estrecha"));
    const rule = shown.findIndex((line) => line.includes(rules[0].id));
    expect(objection).toBeGreaterThan(0);
    expect(objection).toBeLessThan(rule);
    expect(installed("rules.yml")).toEqual([rules[0].id]);
  });

  it("shows every rule, and the ones that leave, before it asks; then installs the proposal as read", async () => {
    write("rules.yml", [entry(rules[0]), entry(rules[1])]);
    await propose([entry(rules[0], "kind: out-of-scope, reason: no es una acción")]);
    const confirm = (nonce) => { // the proposal changes while the human reads: what was shown is what lands
      fs.writeFileSync(file("rules.proposed.yml"), "version: 1\nrules: []\n");
      return nonce;
    };
    const res = await approve({ deps: { ...HUMAN.deps, confirm } });
    expect(res.code).toBe(0);
    expect(shown[0]).toMatch(/Reviewed by codex, a different AI/);
    const seen = shown.join("\n");
    expect(seen).toMatch(new RegExp(`${rules[0].id}.*out-of-scope.*Nunca despliegues sin permiso.*no es una acción`, "s"));
    expect(seen).toMatch(new RegExp(`1 rule\\(s\\) LEAVE:\\n${rules[1].id}`));
    expect(yaml.load(fs.readFileSync(file("rules.yml"), "utf8")).rules).toEqual([
      { id: rules[0].id, source: "CLAUDE.md", text: rules[0].text, kind: "out-of-scope", reason: "no es una acción" },
    ]);
    expect(fs.existsSync(file("rules.proposed.yml"))).toBe(false);
  });

  // KJC-TSK-0961 (ADR 0017): what comes from the user's private MD files is not versioned.
  it("installs each rule by where it is written: the project's versioned, the private ones local", async () => {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "- Nunca toques otro repo.\n");
    const foreign = listRules(dir, { home }).at(-1);
    await propose([entry(rules[0]), entry(foreign, undefined, "~/.claude/CLAUDE.md")]);
    expect((await approve()).code).toBe(0);
    expect(installed("rules.yml")).toEqual([rules[0].id]);
    expect(installed("rules.local.yml")).toEqual([foreign.id]);
    expect(shown.join("\n")).toMatch(new RegExp(`${foreign.id}.*not versioned`));
    expect(fs.readFileSync(file("rules.yml"), "utf8")).not.toContain("otro repo");
    // a later proposal with no private rule leaves no stale local file behind
    await propose([entry(rules[0])]);
    expect((await approve()).code).toBe(0);
    expect(fs.existsSync(file("rules.local.yml"))).toBe(false);
  });
});
