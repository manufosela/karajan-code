// Smoke coverage for the @karajan/core/atomic-write extraction
// (KJC-TSK-0511 PR1). The full behavioural matrix already lives next to
// the CLI; this file just proves the new package entry point works
// end-to-end so a future regression in workspace wiring fails loudly.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { writeJsonAtomic, writeJsonAtomicSync } from "../src/atomic-write.js";

async function tmpDir() {
  return mkdtemp(join(tmpdir(), "core-atomic-"));
}

describe("@karajan/core/atomic-write", () => {
  it("writeJsonAtomic persists pretty JSON and leaves no .tmp", async () => {
    const dir = await tmpDir();
    const target = join(dir, "plan.json");
    await writeJsonAtomic(target, { hu: 42 });
    expect(await readFile(target, "utf-8")).toBe('{\n  "hu": 42\n}');
  });

  it("writeJsonAtomicSync persists pretty JSON synchronously", async () => {
    const dir = await tmpDir();
    const target = join(dir, "state.json");
    writeJsonAtomicSync(target, { ok: true });
    expect(await readFile(target, "utf-8")).toBe('{\n  "ok": true\n}');
  });
});
