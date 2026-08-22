// KJC-BUG-0149 — a published package must declare every bare import it makes:
// inside the monorepo the root hoists everything and hides the gap; outside
// (tribbu-atlas installing @karajan-family/console) the import simply fails.
// This guard reads the sources of each publishable family package and checks
// its own package.json — node builtins and workspace siblings excepted.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PACKAGES = ["packages/governance", "packages/console"];
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
};
const bareImports = (src) =>
  [...src.matchAll(/(?:^|\n)\s*import\s[^'"]*?from\s+["']([^./][^"']*)["']|import\(\s*["']([^./][^"']*)["']\s*\)/g)]
    .map((m) => m[1] || m[2])
    .filter((s) => !s.startsWith("node:"))
    .map((s) => (s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]));

describe("family packages declare their dependencies", () => {
  for (const pkgDir of PACKAGES) {
    it(`${pkgDir} declares every bare import in package.json`, () => {
      const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
      const declared = new Set(Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }));
      const files = ["src", "bin"].map((d) => join(pkgDir, d)).filter(existsSync).flatMap((d) => walk(d));
      const used = new Set(files.flatMap((f) => bareImports(readFileSync(f, "utf8"))));
      const missing = [...used].filter((name) => !declared.has(name));
      expect(missing, `${pkgDir} imports undeclared: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
