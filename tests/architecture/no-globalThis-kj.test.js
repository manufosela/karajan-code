/**
 * Architecture regression guard — no `globalThis.__KJ_*` reads outside the
 * single test-harness resolution site.
 *
 * Pre-v2.7.5 the codebase had ~5 production code paths reading
 * `globalThis.__KJ_*` directly (flow-runner.js, preflight-checks.js,
 * semantic-detector.js). The audit flagged this as spooky-action-at-a-
 * distance: a stray test-harness leftover (or a slow-to-clear global in
 * a parallel test worker) could flip a production default, and tests
 * exercised a different code path than production users.
 *
 * TSK-0334 isolated the `globalThis.__KJ_*` lookup to a single site —
 * `src/config/test-harness.js::resolveTestHarness()` — which runs once
 * during config load and writes the resolved values to
 * `config.testHarness.*`. All production code reads from `config.*` only.
 *
 * This invariant fails CI if any `globalThis[...__KJ_...]` or
 * `globalThis.__KJ_` read reappears under `src/` outside the allowed site.
 * Comments (line and block) are stripped before scanning so documentation
 * referencing the old pattern does not trip the guard.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_DIR = path.join(REPO_ROOT, "src");

// The ONLY file allowed to read globalThis.__KJ_* — the single resolution
// site that feeds config.testHarness.*.
const ALLOWED_FILES = new Set([
  path.join(SRC_DIR, "config", "test-harness.js"),
]);

function listJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsFiles(p, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(p);
  }
  return out;
}

/**
 * Strip // line comments and /* block comments *\/ from source.
 * Not a full JS parser — it ignores string-literal content too, but that's
 * fine here: we only care about matches that survive in executable code.
 */
function stripComments(source) {
  // Remove block comments first (non-greedy, across lines).
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Then remove line comments.
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return out;
}

// Matches executable reads: `globalThis.__KJ_XYZ` or `globalThis["__KJ_XYZ"]`.
const GLOBAL_READ_RE = /globalThis\s*(?:\.\s*__KJ_[A-Z0-9_]*|\[\s*["'`]__KJ_[A-Z0-9_]*["'`]\s*\])/;

describe("architecture/no-globalThis-kj — test-harness globals isolated to single site", () => {
  it("no src/ file outside src/config/test-harness.js reads globalThis.__KJ_*", () => {
    const files = listJsFiles(SRC_DIR);
    const offenders = [];
    for (const file of files) {
      if (ALLOWED_FILES.has(file)) continue;
      const source = fs.readFileSync(file, "utf8");
      const code = stripComments(source);
      if (GLOBAL_READ_RE.test(code)) {
        const match = code.match(GLOBAL_READ_RE);
        offenders.push({ file: path.relative(REPO_ROOT, file), snippet: match?.[0] ?? "" });
      }
    }
    const msg = offenders
      .map((o) => `  ${o.file}: ${o.snippet}`)
      .join("\n");
    expect(
      offenders,
      "globalThis.__KJ_* reads must live only in src/config/test-harness.js.\n" +
      "Production code should read config.testHarness.* instead.\n" +
      "See src/config/test-harness.js for the resolution contract.\n\n" +
      "Offenders:\n" + msg,
    ).toEqual([]);
  });

  it("the allowed site actually reads globalThis", () => {
    // Sanity: if we ever accidentally empty out test-harness.js, the
    // invariant above still passes vacuously. This case guards against that.
    const source = fs.readFileSync(path.join(SRC_DIR, "config", "test-harness.js"), "utf8");
    expect(source).toMatch(/globalThis\s*\[/);
  });

  it("resolveTestHarness returns a frozen object with the documented keys", async () => {
    const mod = await import("../../src/config/test-harness.js");
    const resolved = mod.resolveTestHarness({});
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(resolved).toHaveProperty("disableSonarStage");
    expect(resolved).toHaveProperty("defaultSkillsMode");
    expect(resolved).toHaveProperty("defaultPreflightExtended");
    expect(resolved).toHaveProperty("defaultBrainDecisor");
    expect(resolved).toHaveProperty("defaultAddyosmaniEnabled");
  });
});
