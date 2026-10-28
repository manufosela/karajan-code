// KJC-BUG-0092 — `kj doctor` native-build (better-sqlite3) check.
import { describe, expect, it } from "vitest";
import { createNativeBuildCheck } from "../../src/checks/native-build.js";

describe("checks/native-build — KJC-BUG-0092", () => {
  it("ok when the native addon loads", async () => {
    const check = createNativeBuildCheck({ loadDb: async () => {}, isPnpm: () => false });
    const r = await check.detect();
    expect(r).toMatchObject({ ok: true, severity: "info" });
    expect(r.detail).toMatch(/better-sqlite3/);
  });

  it("warns with the pnpm remedy when the build was skipped under pnpm", async () => {
    const check = createNativeBuildCheck({
      loadDb: async () => {
        throw new Error("Cannot find module 'better-sqlite3'");
      },
      isPnpm: () => true,
    });
    const r = await check.detect();
    expect(r).toMatchObject({ ok: false, severity: "warn" });
    expect(r.detail).toMatch(/pnpm/i);
    expect(r.fix).toMatch(/approve-builds/);
  });

  // KJC-BUG-0426 (issue #2670): npm 12 blocks install scripts outside allowScripts, so
  // reinstalling blocks them again; the fix approves and rebuilds in kj's own package dir.
  it("under npm 12 gives the approve-and-rebuild remedy in kj's package dir", async () => {
    const check = createNativeBuildCheck({
      loadDb: async () => {
        throw new Error("Could not locate the bindings file.");
      },
      isPnpm: () => false,
      npmMajor: () => 12,
      pkgDir: "/opt/node/lib/node_modules/@karajan-family/code",
    });
    const r = await check.detect();
    expect(r).toMatchObject({ ok: false, severity: "warn" });
    expect(r.detail).toMatch(/allowScripts/);
    expect(r.fix).toBe(
      'cd "/opt/node/lib/node_modules/@karajan-family/code" && npm install-scripts approve better-sqlite3 && npm install-scripts approve node-pty && npm rebuild better-sqlite3 node-pty',
    );
  });

  it("warns with a reinstall remedy when it fails outside pnpm", async () => {
    const check = createNativeBuildCheck({
      loadDb: async () => {
        throw new Error("boom");
      },
      isPnpm: () => false,
      npmMajor: () => 11,
    });
    const r = await check.detect();
    expect(r).toMatchObject({ ok: false, severity: "warn" });
    expect(r.fix).toMatch(/npm i -g @karajan-family\/code/); // MIG-B: the scoped name is primary
    expect(r.fix).not.toMatch(/approve-builds/);
  });
});
