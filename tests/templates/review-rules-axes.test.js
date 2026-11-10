// HU-3751 — the review rules template carries the five axes, the approval
// standard and the kj rules; the origin line follows the catalog pin.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const text = fs.readFileSync(path.join(root, "templates", "review-rules.md"), "utf8");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "catalogs", "third-party.json"), "utf8"));
const addy = catalog.sources.find((s) => s.source === "addyosmani/agent-skills/skills");
describe("review-rules template (HU-3751)", () => {
  it.each(["Correctness", "Readability and simplicity", "Architecture", "Security", "Performance"])("has the %s axis", (axis) => {
    expect(text).toMatch(new RegExp(`^## ${axis}`, "m"));
  });
  it("states the approval standard with blocking apart from suggestions", () => {
    expect(text).toMatch(/definitely improves code health/);
    expect(text).toMatch(/BLOCKING only for a concrete production risk/);
    expect(text).toMatch(/Label non-blocking suggestions/);
  });
  it("carries the three kj rules and the never-downgraded security line", () => {
    expect(text).toMatch(/passes when its tool, config or input is missing/);
    expect(text).toMatch(/two copies of the same rule/i);
    expect(text).toMatch(/weakens a test or an assertion, or skips a test/);
    expect(text).toMatch(/never downgraded to suggestions/i);
  });
  it("keeps the two existing sections byte for byte", () => {
    expect(text).toContain("## Environment isolation\n\n- Reject changes that hardcode ports, DB names or service hostnames instead of\n  reading them from env vars, and any diff that adds a real `.env` (only\n  `.env.example` is versioned).\n");
    expect(text).toContain("## File overwrite detection (BLOCKING)\n\n- If the diff shows an entire file was replaced (massive deletions + additions instead of targeted edits), flag it as BLOCKING.\n- Check specifically for: reverted brand colors, lost CSS styles, removed existing functionality, overwritten config values.\n- A diff where most lines of a file are removed and re-added with minor changes is a sign of full-file overwrite.\n");
  });
  it("has one origin line with the pinned commit", () => {
    expect(addy.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(text).toContain(`Origin: the five axes follow addyosmani/agent-skills code-review-and-quality @ ${addy.commit}; the skill adds detail when atril provides it.`);
  });
  it("is the same text this repository's own reviewer reads", () => {
    expect(fs.readFileSync(path.join(root, ".karajan", "review-rules.md"), "utf8")).toBe(text);
  });
  it("is at most 40 lines", () => {
    expect(text.trimEnd().split("\n").length).toBeLessThanOrEqual(40);
  });
});
