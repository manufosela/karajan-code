/**
 * Diet refactor — orchestrator/brain test shape contract.
 *
 * Gherkin pin (HU acceptance):
 *   Given an orchestrator test that mocked 6 collaborators and asserted
 *         invocation order
 *   When the diet refactor lands
 *   Then that test calls the public entry point with in-memory fs / fake
 *        clock and asserts on observable output (file written, exit code,
 *        returned promise resolution) rather than on mock.calls order.
 *
 * Translation: scan every test file under tests/orchestrator/ and tests/brain/
 * and assert NO file mocks 6+ collaborators while also asserting on
 * invocation order. Such files are the prime REFACTOR target per the diet
 * criteria — once the refactor lands they must not reappear.
 *
 * The detection mirrors `tests/_diet/audit.mjs` so the contract stays in one
 * place. Re-implemented locally to avoid coupling the test runtime to the
 * audit script (which doubles as a CLI tool).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// regression-for: HU-test-diet-orchestrator
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SCAN_AREAS = ["tests/orchestrator", "tests/brain", "tests/stages"];
const SELF_FILE = relative(REPO_ROOT, fileURLToPath(import.meta.url));

function listTestFiles(absDir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(absDir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(absDir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTestFiles(full));
    } else if (name.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

function countMockDirectives(content) {
  return (content.match(/\bvi\.(?:mock|doMock)\s*\(/g) || []).length;
}

function hasCallOrderAssertion(content) {
  if (/toHaveBeenNthCalledWith\s*\(/.test(content)) return true;
  if (/invocationCallOrder/.test(content)) return true;
  if (/toHaveBeenCalledBefore\s*\(/.test(content)) return true;
  if (/toHaveBeenCalledAfter\s*\(/.test(content)) return true;
  if (/\.mock\.calls\s*\[\s*\d+\s*\]/.test(content)) return true;
  return false;
}

describe("diet refactor — orchestrator/brain tests don't mock everything + assert call order", () => {
  it("no test file in scope mocks 6+ collaborators while also asserting on invocation order", () => {
    const offenders = [];
    for (const area of SCAN_AREAS) {
      const absDir = join(REPO_ROOT, area);
      for (const file of listTestFiles(absDir)) {
        const rel = relative(REPO_ROOT, file);
        if (rel === SELF_FILE) continue; // don't self-flag this meta-test
        const content = readFileSync(file, "utf8");
        const mockCount = countMockDirectives(content);
        const callOrder = hasCallOrderAssertion(content);
        if (mockCount >= 6 && callOrder) {
          offenders.push({ rel, mockCount });
        }
      }
    }
    expect(offenders, `Files violating diet shape:\n${JSON.stringify(offenders, null, 2)}`).toEqual([]);
  });

  // regression-for: regression
  it("scans non-empty areas (regression: confirm we're really looking at files)", () => {
    let totalScanned = 0;
    for (const area of SCAN_AREAS) {
      totalScanned += listTestFiles(join(REPO_ROOT, area)).length;
    }
    // Sanity: orchestrator/ + brain/ alone have 7+ test files. If this drops
    // to zero the scanner is broken and the first assertion would be vacuous.
    expect(totalScanned).toBeGreaterThanOrEqual(7);
  });
});
