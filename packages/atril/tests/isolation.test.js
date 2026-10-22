// HU-0006 (ADR 0021, decision 7): isolation is checked, not promised. The lint
// rule forbids any import from outside the package, and the packed tarball
// installs and runs in an empty directory.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

const PKG_DIR = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(PKG_DIR, "..", "..");
const lint = async (code) => {
  const [res] = await new ESLint({ cwd: ROOT }).lintText(code, { filePath: join(PKG_DIR, "src", "fixture.js") });
  const rules = ["no-restricted-imports", "no-restricted-syntax", "import-x/no-relative-packages"];
  return res.messages.filter((m) => rules.includes(m.ruleId)).map((m) => m.message);
};

describe("atril imports nothing outside its package", () => {
  it.each([
    ['import { x } from "../../../src/utils/rulesync.js";'],
    ['import { runCommand } from "karajan-core/process";'],
    ['import { decide } from "@karajan-family/governance";'],
    ['const m = await import("../../core/src/paths.js");'],
    ['const m = await import("karajan-core/process");'],
    ["const name = 'karajan-core'; const m = await import(name);"],
    ['import { createRequire } from "node:module";'],
    ['import { createRequire } from "module";'],
  ])("lint rejects %s", async (code) => {
    expect(await lint(code)).not.toEqual([]);
  });

  it("lint accepts imports inside the package and node builtins", async () => {
    expect(await lint('import { join } from "node:path";\nimport { VERSION } from "./index.js";\nexport { join, VERSION };')).toEqual([]);
  });
});

describe("pack smoke", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "atril-pack-")); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("the packed tarball installs in an empty directory and runs", () => {
    const tgz = execFileSync("npm", ["pack", "--silent", "--pack-destination", dir], { cwd: PKG_DIR, encoding: "utf8" }).trim();
    execFileSync("npm", ["init", "-y"], { cwd: dir, stdio: "ignore" });
    execFileSync("npm", ["install", "--offline", "--no-audit", "--no-fund", join(dir, tgz)], { cwd: dir, stdio: "ignore" });
    const installed = join(dir, "node_modules", "@karajan-family", "atril");
    const out = execFileSync(process.execPath, [join(installed, "bin", "atril.js"), "--version"], { encoding: "utf8" });
    expect(out.trim()).toBe(VERSION);
  }, 120000);
});
