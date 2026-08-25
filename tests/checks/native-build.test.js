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

  it("warns with a reinstall remedy when it fails outside pnpm", async () => {
    const check = createNativeBuildCheck({
      loadDb: async () => {
        throw new Error("boom");
      },
      isPnpm: () => false,
    });
    const r = await check.detect();
    expect(r).toMatchObject({ ok: false, severity: "warn" });
    expect(r.fix).toMatch(/npm i -g @karajan-family\/code/); // MIG-B: the scoped name is primary
    expect(r.fix).not.toMatch(/approve-builds/);
  });
});
