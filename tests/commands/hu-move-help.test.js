// KJC-BUG-0257: `kj hu move` named no valid states until the call failed; an
// agent guessed in_progress (the state is running). The help says them now.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HU_STATUSES } from "../../src/commands/hu.js";

const KJ = fileURLToPath(new URL("../../bin/kj.js", import.meta.url));

describe("kj hu move --help", () => {
  it("lists every valid status", () => {
    const r = spawnSync(process.execPath, [KJ, "hu", "move", "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    for (const s of HU_STATUSES) expect(r.stdout).toContain(s);
  });
});
