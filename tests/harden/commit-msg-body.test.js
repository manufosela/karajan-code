// KJC-TSK-0909: un mensaje que el CI va a rechazar no debe llegar ni a crearse.
// 29-sep: una linea de cuerpo de mas de 100 caracteres paso el hook local, la
// rechazo commitlint en el CI y obligo a rehacer dos PRs.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hookBody } from "../../src/harden/hook-templates.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-commitmsg-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (message) => {
  const hook = join(dir, "commit-msg");
  writeFileSync(hook, `#!/bin/sh\n${hookBody("commit-msg", {}, {})}\n`);
  writeFileSync(join(dir, "MSG"), message);
  return spawnSync("sh", [hook, join(dir, "MSG")], { cwd: dir, encoding: "utf8" });
};
const HEADER = "fix(x): something short KJC-TSK-0909";

describe("commit-msg hook", () => {
  it("rejects a body line longer than 100 characters, like the CI does", () => {
    const res = run(`${HEADER}\n\n${"a".repeat(101)}\n`);
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toMatch(/body line.*100/);
  });

  it("accepts body lines up to 100 characters, and ignores git's # comment lines", () => {
    expect(run(`${HEADER}\n\n${"a".repeat(100)}\n# ${"x".repeat(200)}\n`).status).toBe(0);
  });

  it("with commitlint installed in the project, it runs it too, and its verdict counts", () => {
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    const bin = join(dir, "node_modules", ".bin", "commitlint");
    writeFileSync(bin, "#!/bin/sh\necho 'fake commitlint says no'\nexit 1\n");
    chmodSync(bin, 0o755);
    const res = run(`${HEADER}\n\nfine body\n`);
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toMatch(/fake commitlint says no/);
  });
});
