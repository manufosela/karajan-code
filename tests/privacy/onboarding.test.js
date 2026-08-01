// KJC-TSK-0707 (PV-D) — privacy onboarding: kj asks, kj writes the yml.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensurePrivacyList } from "../../src/privacy/onboarding.js";

const scriptedWizard = (answers) => ({ input: async () => answers.shift() ?? "" });
const quiet = { info() {} };

let tmp, target;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kj-privwiz-"));
  target = join(tmp, "privacy.yml");
  process.env.KJ_PRIVACY_CONFIG = target;
});
afterEach(() => { delete process.env.KJ_PRIVACY_CONFIG; rmSync(tmp, { recursive: true, force: true }); });

describe("privacy/onboarding", () => {
  it("asks, writes the yml with personal+allow, and never echoes values", async () => {
    const lines = [];
    const logger = { info: (m) => lines.push(m) };
    const res = await ensurePrivacyList({ isTTY: true, logger, wizard: scriptedWizard(["a@x.com, b@x.com", "600111222", "", "@handle"]) });
    expect(res).toMatchObject({ created: true, entries: 3 });
    const yml = readFileSync(target, "utf8");
    expect(yml).toContain("a@x.com");
    expect(yml).toContain("@handle");
    expect(lines.join("\n")).not.toContain("a@x.com"); // answers never echoed
  });

  it("does not touch an existing file, skips on all-empty, hints when non-interactive", async () => {
    writeFileSync(target, "personal: []\n");
    expect((await ensurePrivacyList({ isTTY: true, logger: quiet, wizard: scriptedWizard([]) })).reason).toBe("present");
    rmSync(target);
    expect((await ensurePrivacyList({ isTTY: true, logger: quiet, wizard: scriptedWizard(["", "", "", ""]) })).reason).toBe("skipped");
    expect(existsSync(target)).toBe(false);
    expect((await ensurePrivacyList({ isTTY: false, logger: quiet })).reason).toBe("non-interactive");
  });
});
