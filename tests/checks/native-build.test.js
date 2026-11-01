// KJC-BUG-0092 / KJC-TSK-1353 — `kj doctor` native-build check, on node-pty since better-sqlite3 left.
import { describe, expect, it } from "vitest";
import { createNativeBuildCheck } from "../../src/checks/native-build.js";

describe("checks/native-build — KJC-BUG-0092, now node-pty (KJC-TSK-1353)", () => {
  it("ok when node-pty loads", async () => {
    const check = createNativeBuildCheck({ loadPty: async () => {}, isPnpm: () => false });
    const r = await check.detect();
    expect(r).toMatchObject({ ok: true, severity: "info" });
    expect(r.detail).toMatch(/node-pty/);
    expect(check.label).toBe("native modules (node-pty)");
  });

  it("warns with the pnpm remedy when the build was skipped under pnpm", async () => {
    const check = createNativeBuildCheck({
      loadPty: async () => {
        throw new Error("Cannot find module 'node-pty'");
      },
      isPnpm: () => true,
    });
    const r = await check.detect();
    expect(r).toMatchObject({ ok: false, severity: "warn" });
    expect(r.detail).toMatch(/pnpm/i);
    expect(r.detail).toMatch(/terminal is unavailable/);
    expect(r.fix).toMatch(/approve-builds node-pty/);
  });

  // KJC-BUG-0426 (issue #2670): npm 12 blocks install scripts outside allowScripts, so
  // reinstalling blocks them again; the fix approves and rebuilds in kj's own package dir.
  it("under npm 12 gives the approve-and-rebuild remedy in kj's package dir", async () => {
    const check = createNativeBuildCheck({
      loadPty: async () => {
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
      'cd "/opt/node/lib/node_modules/@karajan-family/code" && npm install-scripts approve node-pty && npm rebuild node-pty',
    );
  });

  it("warns with a reinstall remedy when it fails outside pnpm", async () => {
    const check = createNativeBuildCheck({
      loadPty: async () => {
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
