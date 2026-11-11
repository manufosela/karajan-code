// HU-3961 (KJC-BUG-0558): kj hooks set|unset run the REAL human act (no stubbed `act`),
// and every act id used in src/ is in the catalog, so the next missing entry fails CI.
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hooksSetCommand, hooksUnsetCommand } from "../../src/commands/hooks.js";
import { HUMAN_ACTS } from "../../src/harden/human-act.js";
import { explainAct } from "../../src/harden/act-sign.js";
import { setNormalLevel } from "../_fixtures/set-normal-level.js";

let dir;
let home;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-hooks-act-"));
  home = mkdtempSync(join(tmpdir(), "kj-hooks-home-"));
  setNormalLevel(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const human = () => ({
  home, logger: { warn() {}, info() {} }, env: {}, ttyHuman: true,
  ancestry: { readProc: () => ({ ppid: 1, cmd: "bash" }) }, confirm: (nonce) => nonce,
  phone: { enrolled: () => false },
});
const configPath = () => join(dir, ".karajan", "kj.config.yml");
const quiet = { print() {} };

describe("kj hooks set|unset through the real human act", () => {
  it("set writes the pin and unset removes it", async () => {
    await hooksSetCommand({ step: "lint", command: "make lint", projectDir: dir, deps: human(), ...quiet });
    expect(readFileSync(configPath(), "utf8")).toContain("make lint");
    await hooksUnsetCommand({ step: "lint", projectDir: dir, deps: human(), ...quiet });
    expect(readFileSync(configPath(), "utf8")).not.toContain("make lint");
  });

  it("an agent session is refused and writes nothing", async () => {
    const deps = { ...human(), env: { CLAUDECODE: "1" } };
    await expect(hooksSetCommand({ step: "lint", command: "make lint", projectDir: dir, deps, ...quiet })).rejects.toThrow();
    expect(existsSync(configPath())).toBe(false);
  });

  it("the act has an explanation for the phone", () => {
    expect(explainAct("hooks-set")).toContain("Qué se va a hacer");
  });
});

function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((e) => {
    const p = join(root, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(js|mjs)$/.test(e.name) ? [p] : [];
  });
}

describe("catalog of human acts", () => {
  it("every id given to humanAct, humanActOf or signAct in src/ is in HUMAN_ACTS", () => {
    const used = new Set();
    for (const file of sourceFiles(join(import.meta.dirname, "..", "..", "src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\b(?:humanAct|humanActOf|signAct)\(\s*"([a-z][a-z-]*)"/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((id) => !(id in HUMAN_ACTS))).toEqual([]);
  });
});
