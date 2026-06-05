// KJC-TSK-0384 PR 2 — onboard role + command acceptance pins.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboarderRole } from "../../src/roles/onboarder-role.js";
import { createNoopLoggerWithContext } from "../_fixtures/loggers.js";

const noopLogger = createNoopLoggerWithContext();

describe("OnboarderRole — KJC-TSK-0384 PR 2", () => {
  const role = new OnboarderRole({});
  it("extractInput accepts { bundle } and string", () => {
    expect(role.extractInput({ bundle: { projectDir: "/x" } }).bundle.projectDir).toBe("/x");
    expect(role.extractInput("/y").bundle.projectDir).toBe("/y");
  });
  it("parseOutput unwraps fenced markdown and trims plain", () => {
    expect(role.parseOutput("# Plain").brief).toBe("# Plain");
    expect(role.parseOutput("```markdown\n# Fenced\n```").brief).toBe("# Fenced");
  });
  it("buildSummary + buildSuccessResult shape ok", () => {
    expect(role.buildSummary({ brief: "a\nb\nc" })).toMatch(/3 lines/);
    expect(role.buildSuccessResult({ brief: "x" }, "claude")).toEqual({ brief: "x", provider: "claude" });
  });
});

describe("onboardCommand — KJC-TSK-0384 PR 2", () => {
  let root, prevHome;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kj-onboard-cmd-"));
    prevHome = process.env.KARAJAN_HOME;
    process.env.KARAJAN_HOME = mkdtempSync(join(tmpdir(), "kj-home-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (process.env.KARAJAN_HOME) rmSync(process.env.KARAJAN_HOME, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.KARAJAN_HOME;
    else process.env.KARAJAN_HOME = prevHome;
  });

  it("--no-synth writes raw bundle without invoking any LLM", async () => {
    const { onboardCommand } = await import("../../src/commands/onboard.js");
    const result = await onboardCommand({
      config: { projectDir: root }, logger: noopLogger, flags: { noSynth: true },
    });
    expect(existsSync(result.path)).toBe(true);
    expect(readFileSync(result.path, "utf8")).toContain("# Onboarding bundle");
    expect(result.brief).toBeNull();
    expect(result.bundle.projectDir).toBe(root);
  });

  // KJC-BUG-0061: Commander maps `--no-synth` to `flags.synth=false`. The
  // command must accept both the API-style `noSynth: true` and the CLI
  // shape `synth: false` and skip the LLM in either case.
  it("--no-synth via Commander shape (flags.synth=false) skips LLM", async () => {
    const { onboardCommand } = await import("../../src/commands/onboard.js");
    const result = await onboardCommand({
      config: { projectDir: root }, logger: noopLogger, flags: { synth: false },
    });
    expect(existsSync(result.path)).toBe(true);
    expect(readFileSync(result.path, "utf8")).toContain("# Onboarding bundle");
    expect(result.brief).toBeNull();
  });
});
