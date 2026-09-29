// KJC-TSK-0910: el tamano de la rama se mide mientras se escribe, con el MISMO
// calculo que el gate del CI, incluidos los cambios sin commitear y los
// ficheros nuevos aun sin anadir (que es donde crece una rama al escribirla).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { branchSize } from "../../src/commands/pr-size.js";

let dir;
const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
const lines = (n) => `${Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join("\n")}\n`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-prsize-"));
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.js"), lines(5));
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  git("checkout", "-q", "-b", "feat/x");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("branchSize", () => {
  it("counts committed, uncommitted and untracked-new lines against the base", async () => {
    writeFileSync(join(dir, "b.js"), lines(10));
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "b");
    writeFileSync(join(dir, "a.js"), lines(8)); // +3 uncommitted
    mkdirSync(join(dir, "tests"));
    writeFileSync(join(dir, "tests", "b.test.js"), lines(4)); // untracked
    const s = await branchSize({ projectDir: dir, base: "main" });
    expect(s).toMatchObject({ added: 17, testAdded: 4, exempt: 0 });
  });

  it("an empty new file adds no lines, as git counts it", async () => {
    writeFileSync(join(dir, "empty.js"), "");
    expect((await branchSize({ projectDir: dir, base: "main" })).added).toBe(0);
  });

  it("human docs are exempt, as in the CI gate", async () => {
    writeFileSync(join(dir, "README.md"), lines(50));
    const s = await branchSize({ projectDir: dir, base: "main" });
    expect(s).toMatchObject({ added: 0, exempt: 50 });
  });
});
