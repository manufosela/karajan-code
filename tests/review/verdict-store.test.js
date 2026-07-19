// ENV-B1 (KJC-TSK-0637): the verdict store ties a reviewer verdict to the
// EXACT diff content via sha256. If the code changes after the review, the
// hash no longer matches and the verdict is void — resolve-until-pass by
// construction. This is the contract the pre-commit hook (ENV-C) verifies.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diffHash, saveVerdict, loadVerdict, checkVerdict } from "../../src/review/verdict-store.js";

const DIFF = "diff --git a/a.js b/a.js\n+const x = 1;\n";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verdict-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("verdict store", () => {
  it("hashes the raw diff deterministically", () => {
    expect(diffHash(DIFF)).toBe(diffHash(DIFF));
    expect(diffHash(DIFF)).not.toBe(diffHash(`${DIFF} `));
    expect(diffHash(DIFF)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("saves and loads a verdict keyed by diff hash", async () => {
    const verdict = { verdict: "approved", reviewer: "codex", issues: [] };
    const saved = await saveVerdict(dir, DIFF, verdict);
    expect(saved.diffHash).toBe(diffHash(DIFF));
    const loaded = await loadVerdict(dir, saved.diffHash);
    expect(loaded.verdict).toBe("approved");
    expect(loaded.reviewer).toBe("codex");
    expect(loaded.timestamp).toBeTruthy();
  });

  it("checkVerdict passes only for an approved verdict on the SAME diff", async () => {
    await saveVerdict(dir, DIFF, { verdict: "approved", reviewer: "codex", issues: [] });
    expect((await checkVerdict(dir, DIFF)).ok).toBe(true);
    const changed = await checkVerdict(dir, `${DIFF}+const y = 2;\n`);
    expect(changed.ok).toBe(false);
    expect(changed.reason).toMatch(/no verdict/i);
  });

  it("checkVerdict fails for a rejected verdict even with matching hash", async () => {
    await saveVerdict(dir, DIFF, { verdict: "rejected", reviewer: "codex", issues: [{ id: "I1" }] });
    const res = await checkVerdict(dir, DIFF);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/rejected/i);
    expect(res.verdict.issues).toHaveLength(1);
  });

  it("checkVerdict fails cleanly when nothing was ever reviewed", async () => {
    const res = await checkVerdict(dir, DIFF);
    expect(res.ok).toBe(false);
  });
});
