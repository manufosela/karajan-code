import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// v2.30.0 — Categories metadata for the grouped settings modal.
// Verifies that:
//   1. CATEGORIES exposes the documented sections with id/label/icon/order.
//   2. Every EDITABLE_FIELDS entry declares a `category` that maps to a
//      known CATEGORY id (no silent "Otros" fallback hiding misspellings).
//   3. The grouping the UI relies on is consistent with the documented
//      buckets (agents/pipeline/rag/session/quality).
//   4. readConfig() echoes categories so the client can render sections
//      without re-importing the constant.

let home;
let originalEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kj-cfg-cats-"));
  originalEnv = process.env.KARAJAN_HOME;
  process.env.KARAJAN_HOME = home;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.KARAJAN_HOME;
  else process.env.KARAJAN_HOME = originalEnv;
  rmSync(home, { recursive: true, force: true });
});

const { readConfig, EDITABLE_FIELDS, CATEGORIES } = await import(
  "../../packages/hu-board/src/config-yaml.js"
);

describe("config-yaml — categories metadata (v2.30.0)", () => {
  it("exports the five documented categories with id/label/icon/order", () => {
    expect(Array.isArray(CATEGORIES)).toBe(true);
    const ids = CATEGORIES.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(["agents", "pipeline", "rag", "session", "quality"]),
    );
    for (const cat of CATEGORIES) {
      expect(typeof cat.id).toBe("string");
      expect(typeof cat.label).toBe("string");
      expect(cat.label.length).toBeGreaterThan(0);
      expect(typeof cat.icon).toBe("string");
      expect(typeof cat.order).toBe("number");
    }
  });

  it("every EDITABLE_FIELDS entry declares a category that maps to a known CATEGORY id", () => {
    const validIds = new Set(CATEGORIES.map((c) => c.id));
    for (const f of EDITABLE_FIELDS) {
      expect(f.category, `field ${f.key} is missing a category`).toBeDefined();
      expect(
        validIds.has(f.category),
        `field ${f.key} has unknown category "${f.category}"`,
      ).toBe(true);
    }
  });

  it("groups the documented fields into the expected buckets", () => {
    const byCat = (id) => EDITABLE_FIELDS.filter((f) => f.category === id).map((f) => f.key);
    expect(byCat("agents")).toEqual(["coder", "reviewer", "modelMode"]);
    expect(byCat("session")).toEqual(["maxIterationMinutes", "maxTotalMinutes"]);
    expect(byCat("quality")).toEqual(["sonarEnabled"]);
    expect(byCat("pipeline")).toEqual([
      "plannerEnabled",
      "researcherEnabled",
      "architectEnabled",
      "testerEnabled",
      "securityEnabled",
      "refactorerEnabled",
      "impeccableEnabled",
      "brainEnabled",
    ]);
    expect(byCat("rag")).toEqual([
      "ragPreloadEnabled",
      "ragPreloadTopK",
      "ragPreloadScope",
      "ragEmbedderProvider",
      "ragSearchMode",
      "ragSearchAlpha",
      "ragSearchRerank",
    ]);
  });

  it("readConfig() returns categories sorted by order", () => {
    const out = readConfig();
    expect(Array.isArray(out.categories)).toBe(true);
    expect(out.categories.length).toBe(CATEGORIES.length);
    const orders = out.categories.map((c) => c.order ?? 999);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
  });
});
