// KJC-BUG-0164 — la atribución a IA es superficie EN TODAS PARTES, con
// reglas deterministas: el pre-commit escanea las líneas AÑADIDAS del diff
// staged (ejecutado de verdad, no leído), y el workflow cubre cuerpo y
// título de la PR. Las menciones legítimas a herramientas siguen siendo
// legales; la ATRIBUCIÓN no.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { installHooks } from "../../src/harden/harden-engine.js";

let repo;
const git = (args, env = {}) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, KJ_ALLOW_IDENTITY: "1", ...env } });

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kj-attrib-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  git(["commit", "-q", "--allow-empty", "-m", "chore: init", "--no-verify"]);
  git(["checkout", "-q", "-b", "feat/x"]);
  await installHooks({ projectDir: repo });
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("pre-commit scans ADDED content for AI attribution (KJC-BUG-0164)", () => {
  it("an added line with an attribution footer refuses to commit", () => {
    writeFileSync(join(repo, "CHANGELOG.md"), "## 1.0\n\n🤖 Generated with [Claude Code](https://x)\n");
    git(["add", "CHANGELOG.md"]);
    expect(() => git(["commit", "-q", "-m", "docs: changelog"])).toThrow(/attribution/i);
  });

  it("a legitimate tool MENTION commits fine", () => {
    writeFileSync(join(repo, "notes.md"), "El reviewer del metodo es codex y el coder claude.\n");
    git(["add", "notes.md"]);
    expect(() => git(["commit", "-q", "-m", "docs: notes"])).not.toThrow();
  });
});
