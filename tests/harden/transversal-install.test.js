// ADR 0055 step 4 (KJC-TSK-1558): kj harden in a marked transversal parent wires only the hooks
// into its settings.local.json; --uninstall-transversal takes kj's out; doctor reports the parent and each child.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { hardenCommand } from "../../src/commands/harden.js";
import { installTransversalWiring, transversalWiringReport } from "../../src/harden/transversal-install.js";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

const gitInit = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  return fs.realpathSync(dir);
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const settingsOf = (dir) => path.join(dir, ".claude", "settings.local.json");
const read = (dir) => JSON.parse(fs.readFileSync(settingsOf(dir), "utf8"));
const commands = (settings) => Object.values(settings.hooks ?? {}).flat().flatMap((e) => e.hooks.map((h) => h.command));
const listing = (dir) => fs.readdirSync(dir, { recursive: true }).filter((p) => !p.split(path.sep).some((s) => s === ".git")).toSorted();

describe("kj harden in a transversal parent (ADR 0055 step 4)", () => {
  let parent, alpha, beta;
  beforeEach(() => {
    parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-transversal-install-")));
    fs.writeFileSync(path.join(parent, ".claude-transversal"), "");
    alpha = gitInit(path.join(parent, "alpha"));
    beta = gitInit(path.join(parent, "group", "beta"));
  });
  afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

  it("wires the parent's settings.local.json with the kj-hook guards and touches nothing else", async () => {
    const before = listing(parent);
    const res = await hardenCommand({ projectDir: parent, logger });
    expect(res).toMatchObject({ ok: true, transversal: true, wired: true });
    expect(listing(parent)).toEqual([...before, ".claude", path.join(".claude", "settings.local.json")].toSorted());
    const cmds = commands(read(parent));
    for (const guard of ["pretooluse", "pretooluse-sentinel", "pretooluse-rules", "posttooluse", "stop", "sessionstart"]) {
      expect(cmds.some((c) => c.includes(` ${guard};`))).toBe(true);
    }
    expect(logger.info.mock.calls.flat().join("\n")).toMatch(/kj harden.*cada repo hijo/);
  });

  it("is unchanged by a second run", async () => {
    await hardenCommand({ projectDir: parent, logger });
    const first = fs.readFileSync(settingsOf(parent), "utf8");
    await hardenCommand({ projectDir: parent, logger });
    expect(fs.readFileSync(settingsOf(parent), "utf8")).toBe(first);
  });

  it("--uninstall-transversal removes only kj's entries", async () => {
    fs.mkdirSync(path.join(parent, ".claude"));
    const mine = { matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] };
    fs.writeFileSync(settingsOf(parent), JSON.stringify({ permissions: { allow: ["Read"] }, hooks: { PreToolUse: [mine] } }));
    installTransversalWiring({ parent, logger });
    const res = await hardenCommand({ projectDir: parent, uninstallTransversal: true, logger });
    expect(res).toMatchObject({ ok: true, removed: true });
    expect(read(parent)).toEqual({ permissions: { allow: ["Read"] }, hooks: { PreToolUse: [mine] } });
  });

  it("--uninstall-transversal outside a marked parent fails loudly", async () => {
    const res = await hardenCommand({ projectDir: alpha, uninstallTransversal: true, logger });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/\.claude-transversal/);
  });

  it("doctor's report names the parent's wiring and each child's", () => {
    expect(transversalWiringReport(parent)).toEqual({ parent, wired: false, children: [{ repo: alpha, wired: false }, { repo: beta, wired: false }] });
    installTransversalWiring({ parent, logger });
    installSentinelHooks({ projectDir: alpha, logger });
    expect(transversalWiringReport(parent)).toEqual({ parent, wired: true, children: [{ repo: alpha, wired: true }, { repo: beta, wired: false }] });
  });

  it("doctor's report is null outside a marked parent", () => {
    expect(transversalWiringReport(alpha)).toBeNull();
  });
});
