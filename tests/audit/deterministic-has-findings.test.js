import { describe, it, expect } from "vitest";
import { deterministicContextHasFindings } from "../../src/audit/deterministic-summary.js";

// The chain of ifs this function replaced, kept as the reference it must match.
function reference(ctx) {
  if (!ctx) return false;
  if (ctx.basalCost?.deadExports?.length > 0) return true;
  if (ctx.basalCost?.unusedDependencies?.unused?.length > 0) return true;
  if (ctx.sonarFindings?.available && (ctx.sonarFindings.total ?? 0) > 0) return true;
  if (ctx.sonarFindings?.qualityGate?.status === "ERROR") return true;
  for (const key of ["osvFindings", "semgrepFindings", "infraFindings", "circularDeps", "deadExports", "aiSlop"]) {
    if (ctx[key]?.available && (ctx[key].total ?? 0) > 0) return true;
  }
  if (ctx.growthDelta && (Math.abs(ctx.growthDelta.lines || 0) > 100 || Math.abs(ctx.growthDelta.deps || 0) > 0)) return true;
  if (ctx.envKeys?.available && ((ctx.envKeys.divergent?.length ?? 0) + (ctx.envKeys.incomplete?.length ?? 0)) > 0) return true;
  return false;
}

const counted = (key) => [
  { [key]: { available: true, total: 3 } },
  { [key]: { available: true, total: 0 } },
  { [key]: { available: true } },
  { [key]: { available: false, total: 5 } },
];

const CASES = [
  null, undefined, {},
  { basalCost: { deadExports: ["a"] } }, { basalCost: { deadExports: [] } },
  { basalCost: { unusedDependencies: { unused: ["x"] } } }, { basalCost: { unusedDependencies: { unused: [] } } },
  { sonarFindings: { qualityGate: { status: "ERROR" } } }, { sonarFindings: { qualityGate: { status: "OK" } } },
  ...["sonarFindings", "osvFindings", "semgrepFindings", "infraFindings", "circularDeps", "deadExports", "aiSlop"].flatMap(counted),
  { growthDelta: { lines: 101 } }, { growthDelta: { lines: -101 } }, { growthDelta: { lines: 100 } },
  { growthDelta: { deps: 1 } }, { growthDelta: { deps: -1 } }, { growthDelta: {} }, { growthDelta: null },
  { envKeys: { available: true, divergent: ["A"] } }, { envKeys: { available: true, incomplete: ["B"] } },
  { envKeys: { available: true, divergent: [], incomplete: [] } }, { envKeys: { available: false, divergent: ["A"] } },
];

describe("deterministicContextHasFindings", () => {
  it.each(CASES.map((ctx) => [JSON.stringify(ctx) ?? String(ctx), ctx]))("matches the former chain of checks for %s", (_label, ctx) => {
    expect(deterministicContextHasFindings(ctx)).toBe(reference(ctx));
  });

  it("finds something in each signal on its own and nothing in an empty context", () => {
    expect(deterministicContextHasFindings({})).toBe(false);
    expect(deterministicContextHasFindings({ circularDeps: { available: true, total: 1 } })).toBe(true);
    expect(deterministicContextHasFindings({ growthDelta: { lines: 101 } })).toBe(true);
    expect(deterministicContextHasFindings({ envKeys: { available: true, incomplete: ["B"] } })).toBe(true);
  });
});
