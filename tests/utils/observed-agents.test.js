// KJC-TSK-0728 — the observation census: detecting an agent CLI is NOT
// supporting it. OBSERVED_AGENTS feeds the AI-surface inventory and a single
// aggregate doctor line; KNOWN_AGENTS (pipeline) stays untouched.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OBSERVED_AGENTS, detectObservedAgents, KNOWN_AGENTS } from "../../src/utils/agent-detect.js";
import { checkAiSurface } from "../../src/checks/ai-surface.js";
import { createObservedAgentsCheck } from "../../src/checks/binaries.js";

let dir, binDir, statePath, oldPath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-observed-"));
  binDir = path.join(dir, "bin");
  fs.mkdirSync(binDir);
  statePath = path.join(dir, "ai-surface.json");
  oldPath = process.env.PATH;
});
afterEach(() => {
  process.env.PATH = oldPath;
  fs.rmSync(dir, { recursive: true, force: true });
});

const fakeBin = (name) =>
  fs.writeFileSync(path.join(binDir, name), `#!/bin/sh\necho "${name} 9.9.9"\n`, { mode: 0o755 });

describe("OBSERVED_AGENTS census", () => {
  it("is observation-only: no overlap with the pipeline KNOWN_AGENTS registry", () => {
    const known = new Set(KNOWN_AGENTS.map((a) => a.name));
    for (const agent of OBSERVED_AGENTS) {
      expect(known.has(agent.name)).toBe(false);
      expect(agent.bin).toBeTruthy();
    }
    expect(OBSERVED_AGENTS.map((a) => a.name)).toContain("grok");
    expect(OBSERVED_AGENTS.map((a) => a.name)).toContain("rovodev");
  });

  it("detects an installed CLI with its version and marks unresolvable ones unavailable", async () => {
    fakeBin("grok");
    process.env.PATH = `${binDir}:${oldPath}`;
    const found = await detectObservedAgents();
    const grok = found.find((a) => a.name === "grok");
    expect(grok?.available).toBe(true);
    expect(grok?.version).toContain("9.9.9");
    // Exhaustive absence is environment-dependent (resolveBin also scans
    // fixed dirs like ~/.local/bin) — shape and per-entry flags suffice.
    for (const entry of found) expect(typeof entry.available).toBe("boolean");
  });
});

describe("AI surface × observed CLIs", () => {
  it("extraSurface entries enter the snapshot and the drift report", () => {
    const first = checkAiSurface({ projectDir: dir, home: dir, statePath, extraSurface: [] });
    expect(first.first).toBe(true);
    const second = checkAiSurface({ projectDir: dir, home: dir, statePath, extraSurface: ["grok (cli)"] });
    expect(second.surface).toContain("grok (cli)");
    expect(second.added).toEqual(["grok (cli)"]);
    const third = checkAiSurface({ projectDir: dir, home: dir, statePath, extraSurface: ["grok (cli)"] });
    expect(third.added).toEqual([]);
  });
});

describe("doctor aggregate check", () => {
  it("lists found CLIs as info and never fails when none are present", async () => {
    const none = createObservedAgentsCheck({ detector: async () => [{ name: "grok", available: false }] });
    const emptyRes = await none.detect();
    expect(emptyRes.ok).toBe(true);
    expect(emptyRes.detail).toMatch(/none/i);
    const some = createObservedAgentsCheck({
      detector: async () => [
        { name: "grok", available: true, version: "grok 9.9.9" },
        { name: "kimi", available: false },
      ],
    });
    const res = await some.detect();
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("grok");
    expect(res.detail).not.toContain("kimi");
  });
});
