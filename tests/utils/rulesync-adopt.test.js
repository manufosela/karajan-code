// HU-0004 (ADR 0022, decision 5): kj init offers to adopt rulesync, asks,
// and never assumes. kj's blocks leave CLAUDE.md/AGENTS.md before the import,
// so the user's imported rules never duplicate them.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installGuidelines } from "../../src/harden/guidelines-engine.js";
import { offerRulesyncAdoption } from "../../src/utils/rulesync-adopt.js";

const block = (id) => [`<!-- >>> kj:managed:${id} v1 >>> (note) -->`, `kj ${id} body`, `<!-- <<< kj:managed:${id} <<< -->`].join("\n");
const AGENT_FILE = ["# My project", "", "Team rule: be kind.", "", block("playbook"), block("guidelines"), ""].join("\n");

let dir;
const logger = () => ({ info: vi.fn(), warn: vi.fn() });
const installLocalBin = () => {
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".bin", "rulesync"), "");
};
// A stand-in for rulesync: `init` makes its source dir, as the real one does.
const fakeRulesync = (onImport = () => {}) => vi.fn((cmd, args) => {
  if (args[0] === "init") mkdirSync(join(dir, ".rulesync"));
  if (args[0] === "import") onImport();
});
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-rs-adopt-"));
  writeFileSync(join(dir, "CLAUDE.md"), AGENT_FILE);
  writeFileSync(join(dir, "AGENTS.md"), AGENT_FILE);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("offerRulesyncAdoption", () => {
  it("on yes, moves kj's blocks to a ledger-owned karajan.md before rulesync init and import", async () => {
    installLocalBin();
    const imported = [];
    const run = fakeRulesync(() => imported.push(readFileSync(join(dir, "CLAUDE.md"), "utf8"), readFileSync(join(dir, "AGENTS.md"), "utf8")));
    const confirm = vi.fn(async () => true);
    const res = await offerRulesyncAdoption({ projectDir: dir, flags: {}, interactive: true, confirm, logger: logger(), run });

    expect(res.adopted).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(run.mock.calls.map((c) => c[1])).toEqual([["--version"], ["init"], ["import", "--targets", "claudecode"], ["import", "--targets", "agentsmd"]]);
    expect(imported).toHaveLength(4);
    for (const text of imported) {
      expect(text).not.toContain("kj:managed");
      expect(text).toContain("Team rule: be kind.");
    }
    const rule = readFileSync(join(dir, ".rulesync", "rules", "karajan.md"), "utf8");
    expect(rule).toContain(block("playbook"));
    expect(rule).toContain(block("guidelines"));
    const ledger = JSON.parse(readFileSync(join(dir, ".rulesync", ".owners.json"), "utf8"));
    expect(ledger.entries["rules/karajan.md#playbook"].owner).toBe("kj");
    expect(ledger.entries["rules/karajan.md#guidelines"].owner).toBe("kj");
  });

  it("on no, adopts nothing and kj keeps writing its rules into CLAUDE.md", async () => {
    installLocalBin();
    const run = vi.fn();
    const res = await offerRulesyncAdoption({ projectDir: dir, flags: {}, interactive: true, confirm: async () => false, logger: logger(), run });

    expect(res).toMatchObject({ adopted: false, reason: "declined" });
    expect(run).not.toHaveBeenCalled();
    expect(existsSync(join(dir, ".rulesync"))).toBe(false);
    installGuidelines({ projectDir: dir });
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toMatch(/Team rule: be kind\.[\s\S]*kj:managed:guidelines/);
  });

  it("without a TTY and without a flag, does not adopt and says how", async () => {
    const run = vi.fn();
    const confirm = vi.fn();
    const log = logger();
    const res = await offerRulesyncAdoption({ projectDir: dir, flags: {}, interactive: false, confirm, logger: log, run });

    expect(res).toMatchObject({ adopted: false, reason: "no-answer" });
    expect(confirm).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(log.info.mock.calls.join(" ")).toMatch(/--rulesync/);
  });

  it("with --rulesync and no TTY, adopts without asking", async () => {
    installLocalBin();
    expect((await offerRulesyncAdoption({ projectDir: dir, flags: { rulesync: true }, interactive: false, run: fakeRulesync(), logger: logger() })).adopted).toBe(true);
  });

  it("does not adopt when rulesync is not installed, and gives the install command", async () => {
    const run = vi.fn(() => { throw new Error("not found"); });
    const log = logger();
    const res = await offerRulesyncAdoption({ projectDir: dir, flags: { rulesync: true }, interactive: false, confirm: vi.fn(), logger: log, run });

    expect(res).toMatchObject({ adopted: false, reason: "not-installed" });
    expect(run.mock.calls[0][0]).toBe("npx");
    expect(run.mock.calls[0][1].slice(0, 2)).toEqual(["--no-install", "rulesync"]);
    expect(log.warn.mock.calls.join(" ")).toMatch(/npm install --save-dev rulesync/);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(AGENT_FILE);
  });

  it("asks nothing in a project that already uses rulesync", async () => {
    mkdirSync(join(dir, ".rulesync"));
    const confirm = vi.fn();
    expect(await offerRulesyncAdoption({ projectDir: dir, interactive: true, confirm })).toMatchObject({ adopted: false, reason: "already" });
    expect(confirm).not.toHaveBeenCalled();
  });
});
