// KJC-TSK-0910: el tamano de la rama se mide mientras se escribe, con el MISMO
// calculo que el gate del CI, incluidos los cambios sin commitear y los
// ficheros nuevos aun sin anadir (que es donde crece una rama al escribirla).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { branchSize, prSizeCommand } from "../../src/commands/pr-size.js";

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

  // KJC-BUG-0299: what will not be part of the pipeline's commit is not the branch's size.
  it("excluded paths, tracked or untracked, do not count", async () => {
    writeFileSync(join(dir, "a.js"), lines(8)); // +3, pending before the run
    writeFileSync(join(dir, "CLAUDE.md"), lines(30)); // untracked before the run (AI-rule file: counts)
    writeFileSync(join(dir, "b.js"), lines(10)); // the run's own
    const s = await branchSize({ projectDir: dir, base: "main", exclude: ["a.js", "CLAUDE.md"] });
    expect(s).toMatchObject({ added: 10 });
  });

  it("an empty new file adds no lines, as git counts it", async () => {
    writeFileSync(join(dir, "empty.js"), "");
    expect((await branchSize({ projectDir: dir, base: "main" })).added).toBe(0);
  });

  // KJC-BUG-0434: the CI gate counts net lines; `added` stays for the readers that use it.
  it("reports the net lines too, as the CI gate counts them", async () => {
    writeFileSync(join(dir, "a.js"), lines(5).replaceAll("const", "let")); // 5 rewritten in place
    writeFileSync(join(dir, "b.js"), lines(2)); // 2 new
    const s = await branchSize({ projectDir: dir, base: "main" });
    expect(s).toMatchObject({ added: 7, net: 2 });
  });

  it("human docs are exempt, as in the CI gate", async () => {
    writeFileSync(join(dir, "README.md"), lines(50));
    const s = await branchSize({ projectDir: dir, base: "main" });
    expect(s).toMatchObject({ added: 0, exempt: 50 });
  });
});

// KJC-TSK-1491 (KJC-BUG-0519): the CI gate runs kj pr-size with the PR's base and the budget.
describe("prSizeCommand --base --limit", () => {
  const run = async (flags, config = { projectDir: dir }) => {
    const out = [];
    const res = await prSizeCommand({ config, flags, logger: { info: (l) => out.push(l), error: (l) => out.push(l) } });
    return { res, out: out.join("\n") };
  };

  it("over the limit it fails and says by how much", async () => {
    writeFileSync(join(dir, "b.js"), lines(12));
    const { res, out } = await run({ limit: "10" });
    expect(res.over).toBe(true);
    expect(out).toContain("adds 12 net line(s) against main, over the limit of 10");
  });

  it("within the limit it passes, and --base wins over the configured base", async () => {
    git("checkout", "-q", "-b", "release", "main");
    writeFileSync(join(dir, "c.js"), lines(3));
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c");
    git("checkout", "-q", "-b", "feat/y");
    writeFileSync(join(dir, "d.js"), lines(4));
    const { res } = await run({ base: "release", limit: "5" }, { projectDir: dir, base_branch: "main" });
    expect(res).toMatchObject({ net: 4, base: "release", over: false });
  });

  it("refuses a limit that is not a whole number", async () => {
    await expect(run({ limit: "lots" })).rejects.toThrow("pr-size: --limit must be a whole number of lines (got lots)");
  });
});
