// HU-0006 (ADR 0021, decision 7): isolation is checked, not promised. The lint
// rule forbids any import from outside the package, and the packed tarball
// installs and runs in an empty directory.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { afterAll, describe, expect, it } from "vitest";

const PKG_DIR = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(PKG_DIR, "..", "..");
const lint = async (code) => {
  const [res] = await new ESLint({ cwd: ROOT }).lintText(code, { filePath: join(PKG_DIR, "src", "fixture.js") });
  return res.messages.filter((m) => ["no-restricted-imports", "import-x/no-relative-packages"].includes(m.ruleId)).map((m) => m.message);
};

describe("atril imports nothing outside its package", () => {
  it.each([
    ['import { x } from "../../../src/utils/rulesync.js";'],
    ['import { runCommand } from "karajan-core/process";'],
    ['import { decide } from "@karajan-family/governance";'],
    ['const m = await import("../../core/src/paths.js");'],
  ])("lint rejects %s", async (code) => {
    expect(await lint(code)).not.toEqual([]);
  });

  it("lint accepts imports inside the package and node builtins", async () => {
    expect(await lint('import { join } from "node:path";\nimport { VERSION } from "./index.js";\nexport { join, VERSION };')).toEqual([]);
  });
});

describe("pack smoke", () => {
  const dir = mkdtempSync(join(tmpdir(), "atril-pack-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("the packed tarball installs in an empty directory and runs", () => {
    const tgz = execFileSync("npm", ["pack", "--silent", "--pack-destination", dir], { cwd: PKG_DIR, encoding: "utf8" }).trim();
    execFileSync("npm", ["init", "-y"], { cwd: dir, stdio: "ignore" });
    execFileSync("npm", ["install", "--offline", "--no-audit", "--no-fund", join(dir, tgz)], { cwd: dir, stdio: "ignore" });
    const out = execFileSync(join(dir, "node_modules", ".bin", "atril"), ["--version"], { encoding: "utf8" });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 120000);
});
