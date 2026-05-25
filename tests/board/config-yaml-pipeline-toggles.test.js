import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

// v2.30.0 — pipeline role toggles in EDITABLE_FIELDS.
// Verifies that the board can read the boolean toggles for every
// pipeline stage exposed in the UI, and that writeConfigPatch persists
// them under pipeline.<role>.enabled in the yml.

let home;
let originalEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kj-cfg-pipeline-"));
  originalEnv = process.env.KARAJAN_HOME;
  process.env.KARAJAN_HOME = home;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.KARAJAN_HOME;
  else process.env.KARAJAN_HOME = originalEnv;
  rmSync(home, { recursive: true, force: true });
});

const { readConfig, writeConfigPatch, EDITABLE_FIELDS } = await import(
  "../../packages/hu-board/src/config-yaml.js"
);

const TOGGLE_KEYS = [
  "plannerEnabled",
  "researcherEnabled",
  "architectEnabled",
  "testerEnabled",
  "securityEnabled",
  "refactorerEnabled",
  "impeccableEnabled",
  "brainEnabled",
];

describe("config-yaml — pipeline role toggles (v2.30.0)", () => {
  it("exposes a boolean toggle for every pipeline role", () => {
    for (const key of TOGGLE_KEYS) {
      const field = EDITABLE_FIELDS.find((f) => f.key === key);
      expect(field, `missing field ${key}`).toBeDefined();
      expect(field.type).toBe("boolean");
      expect(field.path.startsWith("pipeline.")).toBe(true);
      expect(field.path.endsWith(".enabled")).toBe(true);
    }
  });

  it("readConfig returns documented defaults when the yml is absent", () => {
    const out = readConfig();
    expect(out.exists).toBe(false);
    const get = (k) => out.fields.find((f) => f.key === k).value;
    expect(get("plannerEnabled")).toBe(true);
    expect(get("researcherEnabled")).toBe(true);
    expect(get("brainEnabled")).toBe(false);
    expect(get("impeccableEnabled")).toBe(false);
  });

  it("writeConfigPatch persists each toggle under pipeline.<role>.enabled", () => {
    const res = writeConfigPatch({
      plannerEnabled: false,
      brainEnabled: true,
      impeccableEnabled: true,
    });
    expect(res.written).toBe(true);
    expect(res.errors).toEqual([]);

    const parsed = yaml.load(readFileSync(res.path, "utf8"));
    expect(parsed.pipeline.planner.enabled).toBe(false);
    expect(parsed.pipeline.brain.enabled).toBe(true);
    expect(parsed.pipeline.impeccable.enabled).toBe(true);
    // Other roles must NOT be touched if the user didn't ask.
    expect(parsed.pipeline.researcher).toBeUndefined();
  });

  it("re-reading after a write reflects the persisted toggles", () => {
    writeConfigPatch({ brainEnabled: true });
    const out = readConfig();
    const get = (k) => out.fields.find((f) => f.key === k).value;
    expect(get("brainEnabled")).toBe(true);
    expect(get("plannerEnabled")).toBe(true); // unchanged → default
  });

  it("rejects non-boolean values with a clear error", () => {
    const res = writeConfigPatch({ plannerEnabled: "yes" });
    expect(res.written).toBe(false);
    expect(res.errors.some((e) => e.includes("plannerEnabled"))).toBe(true);
    expect(existsSync(join(home, "kj.config.yml"))).toBe(false);
  });
});
