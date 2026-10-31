// KJC-TSK-0662: 5.0 retired the kj run pipeline, which kept its user stories in
// ~/.karajan/hu-stories/. Nothing reads that folder any more; kj doctor says it is
// there and how to clear it, and never touches it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLegacyHuStoriesCheck } from "../../src/checks/dir-setup.js";

let home;
const saved = process.env.KARAJAN_HOME;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-hu-stories-"));
  process.env.KARAJAN_HOME = home;
});
afterEach(() => {
  if (saved === undefined) delete process.env.KARAJAN_HOME;
  else process.env.KARAJAN_HOME = saved;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("legacy hu-stories check", () => {
  it("warns with the count and the kj clean command, and leaves the folder as it was", async () => {
    for (const b of ["batch-a", "batch-b"]) fs.mkdirSync(path.join(home, "hu-stories", b), { recursive: true });
    const r = await createLegacyHuStoriesCheck().detect({});
    expect(r).toMatchObject({ ok: false, severity: "warn" });
    expect(r.detail).toMatch(/2 entries/);
    expect(r.detail).toMatch(/kj run/);
    expect(r.fix).toMatch(/^kj clean --hu-days 0 lists what would go.*add --yes to delete it$/);
    expect(fs.readdirSync(path.join(home, "hu-stories"))).toEqual(["batch-a", "batch-b"]);
  });

  it("a folder it cannot read is said, not taken for an absent one", async () => {
    fs.writeFileSync(path.join(home, "hu-stories"), "not a folder");
    const r = await createLegacyHuStoriesCheck().detect({});
    expect(r).toMatchObject({ ok: false, severity: "warn" });
    expect(r.detail).toMatch(/could not read/);
  });

  it("an absent or empty folder is fine", async () => {
    expect(await createLegacyHuStoriesCheck().detect({})).toMatchObject({ ok: true, severity: "info" });
    fs.mkdirSync(path.join(home, "hu-stories"));
    expect(await createLegacyHuStoriesCheck().detect({})).toMatchObject({ ok: true, severity: "info" });
  });
});
