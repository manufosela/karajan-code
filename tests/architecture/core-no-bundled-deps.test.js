import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Architecture regression guard — KJC-BUG-0086.
 *
 * @karajan/core ships INSIDE the karajan-code npm tarball via
 * bundleDependencies. If core declares runtime `dependencies`, npm pack
 * bundles them too — and a dep with a broken `files` field (sqlite-vec
 * ships `files: []`) lands without its entry point, so `kj --version`
 * crashes with ERR_MODULE_NOT_FOUND on every clean install.
 *
 * Contract: core's runtime deps that the host root already provides
 * (better-sqlite3, execa, sqlite-vec) MUST be peerDependencies, never
 * `dependencies`, so they resolve from the consumer's top-level
 * node_modules (complete, and with the right native binary per platform).
 *
 * If you add a NEW runtime dep to @karajan/core, declare it as a
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

  it("@karajan/core declares NO runtime dependencies (would be bundled incompletely)", () => {
    expect(corePkg.dependencies ?? {}).toEqual({});
  });

  it("every @karajan/core peerDependency is provided by the root karajan-code dependencies", () => {
    const peers = Object.keys(corePkg.peerDependencies ?? {});
    expect(peers.length).toBeGreaterThan(0);
    for (const dep of peers) {
      expect(rootPkg.dependencies?.[dep], `root must declare ${dep} so the bundled core can resolve it`).toBeTruthy();
    }
  });
});
