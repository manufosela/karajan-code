// KJC-TSK-1257: characterization of buildAuditPrompt before it is split into
// one function per section. The refactor must leave every prompt byte-identical.
import { describe, it, expect } from "vitest";
import { buildAuditPrompt } from "../../src/prompts/audit.js";

const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const sonarFindings = {
  available: true, total: 60, qualityGate: { status: "ERROR" },
  issues: [...many(40, (i) => ({ severity: "MAJOR", component: `src/a${i}.js`, line: i + 1, rule: "js:S1", message: "m" })), ...many(20, (i) => ({ severity: "MINOR", component: `src/b${i}.js`, message: "n" })), { severity: "WEIRD" }],
};
const osvFindings = {
  available: true, total: 3,
  vulnerabilities: [{ id: "GHSA-1", package: "lodash", version: "4.0.0", fixed: "4.17.21", severity: "high", summary: "proto" }, { id: "CVE-2", severity: "odd" }, { id: "CVE-3", package: "x", summary: "s" }],
};
const semgrepFindings = {
  available: true, total: 55,
  findings: [...many(52, (i) => ({ severity: "ERROR", file: `f${i}.js`, line: 3, rule: "r.x", cwe: ["CWE-79"], message: "xss" })), { severity: "WARNING", rule: "r.y", cwe: "CWE-1" }, { severity: "info", rule: "r.z" }, { rule: "r.w", file: "g.js" }],
};
const deadExports = {
  available: true, total: 45,
  exports: many(30, (i) => ({ path: `e${i}.js`, line: i, name: `x${i}`, severity: "MINOR", rule: "knip:unused-exports" })),
  files: many(15, (i) => ({ path: `u${i}.js`, severity: "MAJOR", rule: "knip:unused-files" })),
};
const circularDeps = { available: true, total: 32, cycles: many(32, (i) => ({ severity: i % 2 ? "MAJOR" : "MINOR", cycle: [`a${i}.js`, `b${i}.js`] })) };
const basalCost = {
  totalLines: 1000, totalFiles: 40, dependencies: { total: 5, dependencies: 3, devDependencies: 2 },
  unusedDependencies: { unused: ["left-pad"] }, deadExports: many(25, (i) => ({ name: `d${i}`, file: `d${i}.js` })),
};
const cwv = { available: true, mode: "cwv-result", url: "https://x", capturedAt: "t", cwv: { pass: false, scores: { lcp: { value: 3000, rating: "poor" } } } };

const cases = {
  minimal: { task: "audit it" },
  everything: {
    task: "audit it", instructions: "custom instructions", context: "ctx",
    stack: { language: "javascript", frameworks: ["astro", "express"], isFrontend: true, isBackend: true, isFullstack: true },
    basalCost, growthDelta: { lines: 10, files: -1, deps: 0, since: "2026-10-01" },
    sonarFindings, osvFindings, semgrepFindings, deadExports, circularDeps, webperf: cwv,
  },
  backendOnly: { task: "t", stack: { language: "go", frameworks: [], isBackend: true }, basalCost: { totalLines: 1, totalFiles: 1, unusedDependencies: { note: "knip not available" } }, webperf: { available: true, mode: "static" } },
  frontendOnly: { task: "t", stack: { frameworks: ["react"], isFrontend: true }, sonarFindings: { available: true, total: 0, qualityGate: { status: "OK" } } },
  explicitDimensions: { task: "t", dimensions: ["accessibility", "security", "nope"], stack: { isBackend: true }, osvFindings: { available: true, total: 0 } },
  emptyStack: { task: "t", stack: { frameworks: [] }, semgrepFindings: { available: false, total: 3 }, deadExports: { available: true, total: 0 }, circularDeps: { available: true, total: 1, cycles: [{ severity: "MINOR" }] } },
};

describe("buildAuditPrompt characterization", () => {
  for (const [name, input] of Object.entries(cases)) {
    it(`renders the ${name} case exactly as before`, () => {
      expect(buildAuditPrompt(input)).toMatchSnapshot();
    });
  }
});
