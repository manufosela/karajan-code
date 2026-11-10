import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CLAUDE_READS_AGENTS_MD, getAgentRulesChecks } from "../../src/checks/agent-rules.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-agent-rules-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A fake runner: `versions` maps a binary to its --version output; absent = not installed. */
const runner = (versions) => async (cmd) => (cmd in versions ? { exitCode: 0, stdout: versions[cmd], stderr: "" } : { exitCode: 127, stdout: "", stderr: "not found" });
const detect = (versions = {}, opts = {}) => getAgentRulesChecks({ projectDir: dir, run: runner(versions), rulesync: false, ...opts })[0].detect();

// KJC-TSK-1504: AGENTS.md is the one rules file; kj says when an agent here would not read it.
describe("agent-rules doctor check (KJC-TSK-1504)", () => {
  it("passes when no agent is left without AGENTS.md", async () => {
    const res = await detect({ claude: `${CLAUDE_READS_AGENTS_MD} (Claude Code)` });
    expect(res.ok).toBe(true);
  });

  it("warns about a CLAUDE.md or GEMINI.md left in the project, naming kj harden", async () => {
    writeFileSync(join(dir, "CLAUDE.md"), "# old\n");
    writeFileSync(join(dir, "GEMINI.md"), "# old\n");
    const res = await detect();
    expect(res).toMatchObject({ ok: false, severity: "warn" });
    expect(res.detail).toMatch(/CLAUDE\.md.*GEMINI\.md/);
    expect(res.fix).toMatch(/kj harden/);
  });

  it("warns when the installed Claude Code is older than the one that reads AGENTS.md", async () => {
    const res = await detect({ claude: "2.1.200 (Claude Code)" });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/Claude Code 2\.1\.200/);
    expect(res.fix).toMatch(/claude update/);
  });

  it("warns when Gemini CLI is installed and its settings do not name AGENTS.md", async () => {
    expect((await detect({ gemini: "0.54.0" })).detail).toMatch(/Gemini CLI.*\.gemini\/settings\.json/);
    mkdirSync(join(dir, ".gemini"));
    writeFileSync(join(dir, ".gemini", "settings.json"), JSON.stringify({ context: { fileName: ["AGENTS.md"] } }));
    expect((await detect({ gemini: "0.54.0" })).ok).toBe(true);
  });

  it("in a Rulesync repo it says Rulesync owns the agent files", async () => {
    writeFileSync(join(dir, "CLAUDE.md"), "# generated\n");
    const res = await detect({}, { rulesync: true });
    expect(res.ok).toBe(true);
    expect(res.detail).toMatch(/Rulesync/);
  });
});
