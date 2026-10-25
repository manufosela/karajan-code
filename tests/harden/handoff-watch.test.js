// KJC-TSK-1066: the human's task window. Every action only the human can take
// (publish, seal, run a script) is a handoff with its date and the exact command,
// and kj handoff watch shows them in another terminal, out of the agent's scroll.
// ADR 0018 holds: a command a gate denied keeps the gate's why, never the agent's.
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handoffCommand } from "../../src/commands/handoff.js";
import { addHandoff, listHandoffs, markHandoffDone, watchHandoffs } from "../../src/harden/handoff.js";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-handoff-watch-"));
  execSync("git init -q -b main && git checkout -q -b feat/KJC-TSK-0001-x", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
    placeGuardCopies(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const PUBLISH = "bash /tmp/publish-4.53.1.sh";

describe("task handoffs", () => {
  it("a task the agent proposes is registered with its why, marked as the agent's, not a gate's", async () => {
    const h = addHandoff({ projectDir: dir, command: PUBLISH, why: "publica kj 4.53.1 con los dos nombres" });
    expect(h).toMatchObject({ kind: "task", command: PUBLISH, status: "pending", why: "publica kj 4.53.1 con los dos nombres", denial: null });
    const lines = [];
    expect(await handoffCommand({ action: "show", config: { projectDir: dir }, flags: { id: h.id }, log: (l) => lines.push(l) })).toBe(0);
    expect(lines.join("\n")).toMatch(/propuesto por el agente, no lo negó ningún gate/);
  });

  it("a command a gate denied keeps the gate's why even if the agent writes another", () => {
    spawnSync("node", [path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs")], { input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command: "git add -A" } }), encoding: "utf8" });
    const h = addHandoff({ projectDir: dir, command: "git add -A", why: "trust me, it is fine" });
    expect(h.kind).toBe("denial");
    expect(h.denial.why).toMatch(/karajan sentinel/);
    expect(h.why).toBeUndefined();
  });

  it("without a denial and without a why there is nothing to register", () => {
    expect(() => addHandoff({ projectDir: dir, command: PUBLISH })).toThrow(/ningún deny para ese comando exacto/);
  });

  it("done takes it out of the pending ones and keeps it in the history", () => {
    const h = addHandoff({ projectDir: dir, command: PUBLISH, why: "publicar" });
    markHandoffDone({ projectDir: dir, id: h.id });
    expect(listHandoffs({ projectDir: dir })[0]).toMatchObject({ id: h.id, status: "done", doneAt: expect.any(String) });
  });
});

describe("kj handoff watch", () => {
  it("shows the pending ones, then each new one as it is registered, with date and why", async () => {
    addHandoff({ projectDir: dir, command: "bash /tmp/a.sh", why: "primera" });
    const lines = [];
    const ctl = new AbortController();
    const watching = watchHandoffs({ projectDir: dir, log: (l) => lines.push(l), intervalMs: 20, signal: ctl.signal });
    await new Promise((r) => setTimeout(r, 60));
    addHandoff({ projectDir: dir, command: PUBLISH, why: "publica kj 4.53.1" });
    await new Promise((r) => setTimeout(r, 80));
    ctl.abort();
    await watching;
    const out = lines.join("\n");
    expect(out).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}.*bash \/tmp\/a\.sh/);
    expect(out).toMatch(/bash \/tmp\/publish-4\.53\.1\.sh\n\s+publica kj 4\.53\.1/);
    expect(out.match(/publish-4\.53\.1/g)).toHaveLength(1);
  });
});
