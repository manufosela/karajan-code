// KJC-BUG-0282 (#1978): the skills kj init installs must pass the gate kj
// enforces. Three of them were rejected by the cross-AI review in a fresh
// consumer repo: default admin credentials, a diff that never sees staged
// work, and a whole-file revert that discards edits the agent did not make.
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../templates/skills");
const skill = (name) => readFile(path.join(SKILLS, `${name}.md`), "utf8");

describe("templates/skills pass the review gate (KJC-BUG-0282)", () => {
  it("kj-sonar authenticates with the token, never with the default admin password", async () => {
    const content = await skill("kj-sonar");
    expect(content).not.toMatch(/admin:admin/);
    expect(content).toContain("KJ_SONAR_TOKEN");
    expect(content).toMatch(/default password/i);
  });

  it("kj-review looks at staged and unstaged work, not only the branch diff", async () => {
    const content = await skill("kj-review");
    expect(content).toContain("git diff --cached");
    expect(content).toMatch(/`git diff`/);
  });

  it("kj-code never reverts a whole file: only the hunks it did not intend", async () => {
    const content = await skill("kj-code");
    expect(content).not.toMatch(/git checkout --/);
    expect(content).toMatch(/hunk/i);
  });

  // The same advice lived in the coder and refactorer role prompts too.
  it("no template kj ships tells the agent to revert a whole file", async () => {
    const files = await readdir(path.resolve(SKILLS, ".."), { recursive: true });
    const offenders = [];
    for (const f of files.filter((p) => p.endsWith(".md"))) {
      if (/git checkout -- /.test(await readFile(path.resolve(SKILLS, "..", f), "utf8"))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
