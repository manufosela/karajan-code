import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Architecture regression guard — KJC-BUG-0086 + KJC-BUG-0103.
 *
 * karajan-core is published to npm and resolved from the registry like any
 * other dependency. It must NEVER return to `bundleDependencies`: on global
 * installs npm nests every dep under karajan-code/node_modules, and bundle
 * semantics mark that whole subtree as "already shipped" — so npm skips
 * fetching better-sqlite3 & friends, leaving EMPTY directories whose install
 * scripts then crash (`npm install -g karajan-code` failed on every fresh
 * machine, KJC-BUG-0103).
 *
 * Contract: core's runtime deps that the host root already provides
 * (better-sqlite3, execa, sqlite-vec) MUST be peerDependencies, never
 * `dependencies`, so they resolve from the consumer's top-level
 * node_modules (complete, and with the right native binary per platform).
 *
 * If you add a NEW runtime dep to karajan-core, declare it as a
 * peerDependency AND add it to the root karajan-code dependencies.
 */
describe("architecture/core-no-bundled-deps (KJC-BUG-0086)", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const corePkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "packages/core/package.json"), "utf8"),
  );
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );

  it("karajan-core declares NO runtime dependencies (would be bundled incompletely)", () => {
    expect(corePkg.dependencies ?? {}).toEqual({});
  });

  it("every karajan-core peerDependency is provided by the root karajan-code dependencies", () => {
    const peers = Object.keys(corePkg.peerDependencies ?? {});
    expect(peers.length).toBeGreaterThan(0);
    for (const dep of peers) {
      expect(rootPkg.dependencies?.[dep], `root must declare ${dep} so core can resolve it`).toBeTruthy();
    }
  });

  it("root declares NO bundleDependencies (breaks fresh global installs, KJC-BUG-0103)", () => {
    expect(rootPkg.bundleDependencies ?? []).toEqual([]);
    expect(rootPkg.bundledDependencies ?? []).toEqual([]);
  });

  it("karajan-core is a registry dependency of the root, pinned to a real range", () => {
    expect(rootPkg.dependencies?.["karajan-core"]).toMatch(/^\^?\d/);
  });
});
