// KJC-TSK-0814 — the Sentinel signs as Karajan and links its documentation.
// Contract: every generated hook message carries the "karajan sentinel:"
// brand (never the old bare "kj sentinel:"), every blocking gate links a
// stable doc anchor, and every linked anchor exists as a literal heading in
// the landing doc page — a dead anchor is a broken promise to the user.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

const DOC_URL = "https://karajancode.com/docs/guides/sentinel/#";
const DOC_PAGE = new URL(
  "../../apps/landing/docs/src/content/docs/guides/sentinel.md",
  import.meta.url,
);

let dir, scripts;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-branding-"));
  installSentinelHooks({ projectDir: dir, logger: { info() {}, warn() {} } });
  const harness = path.join(dir, ".karajan", "harness");
  scripts = fs.readdirSync(harness).map((f) => ({
    name: f,
    body: fs.readFileSync(path.join(harness, f), "utf8"),
  }));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("sentinel branding (KJC-TSK-0814)", () => {
  it("every message signs as karajan — the bare 'kj sentinel:' brand is gone", () => {
    expect(scripts.length).toBeGreaterThanOrEqual(4);
    for (const s of scripts) {
      expect(s.body, `${s.name} still says "kj sentinel:"`).not.toMatch(/kj sentinel:/);
    }
    const withMessages = scripts.filter((s) => s.body.includes("karajan sentinel:"));
    expect(withMessages.length).toBeGreaterThanOrEqual(3);
  });

  it("every blocking gate links its doc anchor", () => {
    const all = scripts.map((s) => s.body).join("\n");
    // The lib holds the base URL once; each gate appends its anchor via doc().
    expect(all).toContain(DOC_URL);
    for (const anchor of [
      "card-first", "cross-lane", "identity", "board-sync", "policy",
      "steward", "claims", "release", "supervisor", "stop-gate", "push-gate", "escapes",
    ]) {
      expect(all, `no doc link for #${anchor}`).toContain(`doc("${anchor}")`);
    }
  });

  it("every linked anchor exists as a literal heading in the doc page", () => {
    const page = fs.readFileSync(DOC_PAGE, "utf8");
    const all = scripts.map((s) => s.body).join("\n");
    const linked = new Set(
      [...all.matchAll(/doc\("([a-z-]+)"\)/g)].map((m) => m[1]),
    );
    expect(linked.size).toBeGreaterThanOrEqual(12);
    for (const anchor of linked) {
      expect(page, `doc page misses heading for #${anchor}`).toMatch(
        new RegExp(`^##\\s+${anchor}\\s*$`, "m"),
      );
    }
  });

  it("the doc page names every real escape", () => {
    const page = fs.readFileSync(DOC_PAGE, "utf8");
    const all = scripts.map((s) => s.body).join("\n");
    const escapes = new Set([...all.matchAll(/KJ_ALLOW_[A-Z_]+/g)].map((m) => m[0]))
      // KJ_ALLOW_X is the generic placeholder in the simple-command rule text.
      .difference(new Set(["KJ_ALLOW_X"]));
    expect(escapes.size).toBeGreaterThanOrEqual(8);
    for (const esc of escapes) {
      expect(page, `doc page misses ${esc}`).toContain(esc);
    }
  });
});
