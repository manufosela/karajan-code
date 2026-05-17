/**
 * Architecture regression guard — session mutations go through mutators.
 *
 * Pre-v2.7.5 there were ~68 direct `session.x = y` assignments scattered
 * across 18 files (142 in `flow-runner.js` alone). The audit (TSK-0337)
 * called this out as a HIGH finding: a bug in a single field meant grep-
 * the-world to find every writer.
 *
 * Post-TSK-0337 the write-boundary rule is:
 *   - `src/session/mutators.js` exports typed setter / counter / append
 *     helpers (setReviewerFeedback, incrementRetryCount, setCiEarlyPr, …).
 *   - Every other file under `src/` uses those helpers instead of a bare
 *     `session.x = y` assignment.
 *
 * This test fails CI if any new direct `session.<field> = value` appears
 * outside the session layer. `config.session.*` paths are allowed — those
 * reference the config shape, not the runtime session object.
 *
 * If you hit this failure: either add a mutator to `src/session/mutators.js`
 * and route through it, or (rare, intentional) whitelist the site in the
 * `ALLOWED` set below with a comment explaining why.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_DIR = path.join(REPO_ROOT, "src");

// Files under the session layer itself are allowed to mutate session freely —
// that's literally their job.
const ALLOWED_DIRS = [
  path.join(SRC_DIR, "session"),
];

// Specific callsites the invariant intentionally whitelists. Add entries as
// `"<relative path>:<line>"` with a short comment above explaining why.
const ALLOWED_SITES = new Set([
  // Nothing yet — everything routed through mutators in TSK-0337.
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

function isInsideAny(file, dirs) {
  return dirs.some((d) => file === d || file.startsWith(d + path.sep));
}

// Matches `session.x = y` / `session.x += y` but NOT:
//   - `session.x === y` / `session.x !== y` / `session.x == y`   (comparisons)
//   - `config.session.x = y` / `out.session.x = y`               (config shape,
//                                                                 not runtime)
// The negative lookbehind `(?<![=!<>.])` rules out comparisons and
// `*.session.foo`-style chains where `session` is itself a property name.
const DIRECT_ASSIGN_RE = /(?<![=!<>.])session\.[A-Za-z_][A-Za-z_0-9]*\s*(?:=|\+=|-=)\s*[^=]/;

function stripCommentsAndStrings(source) {
  // Block comments.
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Line comments. Preserve leading char so `http://` inside strings isn't touched.
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  // Template literals, double-quoted, single-quoted strings — replace with
  // empty string literal to avoid matching inside them.
  out = out
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, "\"\"")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return out;
}

describe("architecture/session-write-boundary — mutations only via src/session/mutators.js", () => {
  it("no direct `session.X = value` outside src/session/", () => {
    const files = listJsFiles(SRC_DIR);
    const offenders = [];

    for (const file of files) {
      if (isInsideAny(file, ALLOWED_DIRS)) continue;
      const source = fs.readFileSync(file, "utf8");
      const cleaned = stripCommentsAndStrings(source);
      const lines = cleaned.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (DIRECT_ASSIGN_RE.test(lines[i])) {
          const rel = path.relative(REPO_ROOT, file);
          const site = `${rel}:${i + 1}`;
          if (ALLOWED_SITES.has(site)) continue;
          offenders.push({ site, snippet: lines[i].trim() });
        }
      }
    }

    const msg = offenders
      .map((o) => `  ${o.site}: ${o.snippet}`)
      .join("\n");
    expect(
      offenders,
      "Direct session mutations outside src/session/ — route through " +
      "src/session/mutators.js (or add a whitelist entry with a reason):\n" + msg,
    ).toEqual([]);
  });

  it("mutators module exports the documented core helpers", async () => {
    // Sanity: if someone accidentally empties out mutators.js, the rule above
    // still passes vacuously (no offenders found). Guard against that.
    const mod = await import("../../src/session/mutators.js");
    for (const name of [
      "setRetryCount", "incrementRetryCount", "resetRetryCount",
      "resetAllRetryCounters", "setReviewerFeedback", "setSonarSummary",
      "setStatus", "setAlternativeAgent", "clearAlternativeAgent",
      "setCiEarlyPr", "appendCiCommits", "setPreflight",
      "setResolvedPolicies", "setBudget", "setRtkSavings",
    ]) {
      expect(typeof mod[name], `missing mutator: ${name}`).toBe("function");
    }
  });
});
