// KJC-TSK-1255: kj audit --sbom <file> writes the CycloneDX SBOM of an npm project's production
// dependencies, from the lockfile, atomically, and says how many components it holds.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSbom } from "../../src/audit/sbom.js";

let dir;
const BOM = JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", components: [{ name: "a" }, { name: "b" }] });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-sbom-")); writeFileSync(join(dir, "package-lock.json"), "{}"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("writeSbom", () => {
  it("writes npm's CycloneDX SBOM of the production dependencies from the lockfile", async () => {
    const run = vi.fn(async () => ({ stdout: BOM }));
    const res = await writeSbom({ projectDir: dir, file: "sbom.json", run });
    expect(run).toHaveBeenCalledWith("npm", ["sbom", "--sbom-format", "cyclonedx", "--omit", "dev", "--package-lock-only"], expect.objectContaining({ cwd: dir }));
    expect(res).toEqual({ file: join(dir, "sbom.json"), components: 2 });
    expect(readFileSync(res.file, "utf8")).toBe(BOM);
  });

  it("writes nothing without a lockfile, and says why", async () => {
    rmSync(join(dir, "package-lock.json"));
    const run = vi.fn();
    await expect(writeSbom({ projectDir: dir, file: "sbom.json", run })).rejects.toThrow(/package-lock\.json/);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["npm fails", async () => { throw Object.assign(new Error("x"), { code: 1, stderr: "npm error code ESBOMPROBLEMS\nmore" }); }, /npm sbom failed: npm error code ESBOMPROBLEMS$/],
    ["npm is missing", async () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); }, /npm not found/],
    ["the output is not a CycloneDX document", async () => ({ stdout: "{}" }), /not a CycloneDX/],
  ])("leaves no file when %s", async (_why, run, said) => {
    await expect(writeSbom({ projectDir: dir, file: "sbom.json", run })).rejects.toThrow(said);
    expect(existsSync(join(dir, "sbom.json"))).toBe(false);
    expect(existsSync(join(dir, "sbom.json.tmp"))).toBe(false);
  });
});
