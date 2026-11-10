// HU-3791 (issue #3604) — the harness runs ONE detector over a repository's
// history, read-only, and says where it first fires and how many times.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { benchDetector } from "../../src/steward/history-bench.js";

const PANEL = `import { LitElement } from "lit";
export class Panel extends LitElement {
  render() { return "Miembros del equipo"; }
  _renderReportsTo() { return "Head al que reporta"; }
}`;
const PHANTOM_SPEC = `test("h", async ({ page }) => {\n  await page.getByLabel("Head al que reporta").click();\n});`;
const LIVE_SPEC = `test("h", async ({ page }) => {\n  await page.getByLabel("Miembros del equipo").click();\n});`;

let repo;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const commit = (files, msg) => {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  }
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", msg);
  return git("rev-parse", "HEAD");
};
const status = () => git("status", "--porcelain");

describe("benchDetector", () => {
  const shas = [];
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kj-bench-"));
    git("init", "-q", "-b", "main");
    shas.push(commit({ "src/panel.js": PANEL, "e2e/h.spec.js": LIVE_SPEC }, "healthy"));
    shas.push(commit({ "e2e/h.spec.js": PHANTOM_SPEC }, "cause"));
    shas.push(commit({ "README.md": "x" }, "still broken"));
    shas.push(commit({ "e2e/h.spec.js": LIVE_SPEC }, "fix"));
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("reports the first firing commit, the count and the commits it read", () => {
    const r = benchDetector({ repoDir: repo, range: "HEAD", detector: "phantom-coverage" });
    expect(r.commits).toBe(4);
    expect(r.firings).toBe(2);
    expect(r.firstFiring).toEqual({ sha: shas[1], index: 1 });
  });

  it("honours the range: commits before it are not read", () => {
    const r = benchDetector({ repoDir: repo, range: `${shas[1]}..HEAD`, detector: "phantom-coverage" });
    expect(r.commits).toBe(2);
    expect(r.firstFiring).toEqual({ sha: shas[2], index: 0 });
  });

  it("a healthy range never fires", () => {
    const r = benchDetector({ repoDir: repo, range: `${shas[2]}..${shas[3]}`, detector: "phantom-coverage" });
    expect(r.firstFiring).toBeNull();
    expect(r.firings).toBe(0);
  });

  it("never writes to the repository (tree, index and refs untouched)", () => {
    const before = [git("rev-parse", "HEAD"), status(), git("for-each-ref")];
    benchDetector({ repoDir: repo, range: "HEAD", detector: "phantom-coverage" });
    expect([git("rev-parse", "HEAD"), status(), git("for-each-ref")]).toEqual(before);
    expect(before[1]).toBe("");
  });

  it("an unknown detector and an option-shaped range are refused loudly", () => {
    expect(() => benchDetector({ repoDir: repo, range: "HEAD", detector: "nope" })).toThrow(/unknown detector.*phantom-coverage/);
    expect(() => benchDetector({ repoDir: repo, range: "--output=x", detector: "phantom-coverage" })).toThrow(/range/);  });
});
