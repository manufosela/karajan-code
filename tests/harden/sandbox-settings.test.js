// KJC-TSK-1092: kj harden --sandbox turns the host sandbox on wherever it can
// start (opt-in since KJC-TSK-1241). The block goes to .claude/settings.local.json: whether bwrap starts is a
// fact of each machine, so it never travels in the shared settings.json.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSandbox } from "../../src/harden/sandbox.js";

let dir;
const local = () => path.join(dir, ".claude", "settings.local.json");
const read = () => JSON.parse(fs.readFileSync(local(), "utf8"));
const writeLocal = (text) => { fs.mkdirSync(path.dirname(local()), { recursive: true }); fs.writeFileSync(local(), text); };
const logs = () => { const out = []; return { out, info: (m) => out.push(m), warn: (m) => out.push(m) }; };
const ready = () => ({ ok: true });

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sandbox-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("installSandbox", () => {
  it("writes nothing when the sandbox cannot start, and says why and what to do", () => {
    const logger = logs();
    const r = installSandbox({ projectDir: dir, logger, probe: () => ({ ok: false, reason: "bwrap is not installed", remedy: "install bubblewrap" }) });
    expect(r.state).toBe("off");
    expect(fs.existsSync(local())).toBe(false);
    expect(logger.out.join("\n")).toMatch(/bwrap is not installed[\s\S]*install bubblewrap/);
  });

  it("turns it on with the method's rules, keeping every key and array entry already there", () => {
    writeLocal(JSON.stringify({ permissions: { allow: ["Bash(npx vitest:*)"] }, sandbox: { excludedCommands: ["docker *"], network: { allowedDomains: ["example.com"] } } }));
    const r = installSandbox({ projectDir: dir, logger: logs(), probe: ready });
    expect(r.state).toBe("on");
    const s = read();
    expect(s.permissions.allow).toEqual(["Bash(npx vitest:*)"]);
    expect(s.sandbox.enabled).toBe(true);
    expect(s.sandbox.allowUnsandboxedCommands).toBe(false);
    expect(s.sandbox.excludedCommands).toEqual(expect.arrayContaining(["docker *", "gh *", "kj review *", "kj worktree *"]));
    expect(s.sandbox.filesystem.denyWrite).toEqual(expect.arrayContaining([".karajan/harness", "~/.karajan/supervisor-phone.json"]));
    // KJC-TSK-1114: what the Sentinel's Bash-text guards hand over to the sandbox.
    expect(s.sandbox.filesystem.denyWrite).toEqual(expect.arrayContaining([".karajan/hooks", ".claude/settings.json", "kj.config.yml", ".ragignore", ".kj/worktrees"]));
    // Outside the project, only state and caches: never a whole config directory.
    for (const broad of ["~/.claude", "~/.codex", "~/.config", "~/.npm", "~"]) expect(s.sandbox.filesystem.allowWrite).not.toContain(broad);
    expect(s.sandbox.network.allowedDomains).toEqual(expect.arrayContaining(["example.com", "github.com", "registry.npmjs.org"]));
  });

  it("is idempotent: a second run adds no duplicates", () => {
    installSandbox({ projectDir: dir, logger: logs(), probe: ready });
    const first = read();
    installSandbox({ projectDir: dir, logger: logs(), probe: ready });
    expect(read()).toEqual(first);
  });

  it("leaves a sandbox the person turned off as it is, and says so", () => {
    writeLocal(JSON.stringify({ sandbox: { enabled: false } }));
    const logger = logs();
    const r = installSandbox({ projectDir: dir, logger, probe: ready });
    expect(r.state).toBe("left-off");
    expect(read()).toEqual({ sandbox: { enabled: false } });
    expect(logger.out.join("\n")).toMatch(/enabled: false/);
  });

  it("never touches a settings.local.json that is not valid JSON", () => {
    writeLocal("{ not json");
    const logger = logs();
    expect(installSandbox({ projectDir: dir, logger, probe: ready }).state).toBe("untouched");
    expect(fs.readFileSync(local(), "utf8")).toBe("{ not json");
    expect(logger.out.join("\n")).toMatch(/not valid JSON/);
  });
});
