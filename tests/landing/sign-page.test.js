import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Structural guard for the phone signer page (KJC-TSK-0822). The page is a
// static, self-contained capability page: everything inline, nothing external.
const pageUrl = new URL("../../apps/landing/public/sign/index.html", import.meta.url);
const html = readFileSync(pageUrl, "utf8");

describe("landing sign page", () => {
  it("has the enroll and approve sections", () => {
    expect(html).toContain('id="enroll"');
    expect(html).toContain('id="approve"');
  });

  it("loads no external scripts, styles or resources", () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc\s*=/i);
    expect(html).not.toMatch(/<link\s/i);
    expect(html).not.toMatch(/@import/);
  });

  it("carries the public firebase api key and talks only to firestore", () => {
    expect(html).toContain("AIzaSyBEZ7CYkAgs1OQbFHeZIW_VVPAXMiIz1X8");
    expect(html).toContain(
      "https://firestore.googleapis.com/v1/projects/karajan-code/databases/(default)/documents/kjSupervisorSign"
    );
  });
});
