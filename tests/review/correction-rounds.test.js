// KJC-TSK-1017: a rejection followed by an approval is the method working, so
// kj names it a review correction with its round count, never a coder error.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { correctionNote, rejectionsBeforeApproval, reviewCorrectionRounds } from "../../src/review/correction-rounds.js";
import { renderPlaybook } from "../../src/environment/playbook.js";

const rec = (diffHash, verdict, timestamp, branch = "feat/x") => ({ diffHash, verdict, timestamp, branch });

describe("correctionNote", () => {
  it("says nothing without rejections and names the rounds otherwise", () => {
    expect(correctionNote(0)).toBe("");
    expect(correctionNote(2)).toMatch(/review correction: 2 round\(s\)/);
    expect(correctionNote(2)).not.toMatch(/error|mistake/i);
  });
});

describe("rejectionsBeforeApproval", () => {
  it("counts the rejections on the branch since its last approval, not the current record", () => {
    const records = [
      rec("a", "rejected", "2026-10-14T01:00:00Z"),
      rec("b", "approved", "2026-10-14T02:00:00Z"),
      rec("c", "rejected", "2026-10-14T04:00:00Z"),
      rec("d", "rejected", "2026-10-14T03:00:00Z"),
      rec("o", "rejected", "2026-10-14T03:30:00Z", "feat/other"),
      rec("e", "approved", "2026-10-14T05:00:00Z"),
    ];
    expect(rejectionsBeforeApproval(records, { branch: "feat/x", hash: "e" })).toBe(2);
  });
});

describe("reviewCorrectionRounds", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rounds-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("reads the verdict store of the project", async () => {
    const store = path.join(dir, ".karajan", "reviews");
    fs.mkdirSync(store, { recursive: true });
    const current = rec("e", "approved", "2026-10-14T05:00:00Z");
    for (const r of [rec("a", "rejected", "2026-10-14T01:00:00Z"), current]) {
      fs.writeFileSync(path.join(store, `${r.diffHash}.json`), JSON.stringify(r));
    }
    expect(await reviewCorrectionRounds(dir, current)).toBe(1);
  });

  it("a record without a branch counts no rounds", async () => {
    expect(await reviewCorrectionRounds(dir, { diffHash: "e", verdict: "approved" })).toBe(0);
  });
});

describe("the method block", () => {
  it("teaches that a cross-AI correction is the method working, not an error to apologise for", () => {
    const text = renderPlaybook();
    expect(text).toMatch(/correction from the other AI is the method working/);
    expect(text).toMatch(/no apology/);
  });
});
