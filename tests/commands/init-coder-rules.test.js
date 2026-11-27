// HU-4999 (#4811): the coder rules kj writes follow the project's stack and base branch.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureCoderRules } from "../../src/commands/init-coder-rules.js";

const logger = { info: () => {} };

describe("ensureCoderRules (HU-4999)", () => {
  let dir;
  let target;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-coder-rules-"));
    target = path.join(dir, "coder-rules.md");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const render = async (marker, content, config) => {
    fs.writeFileSync(path.join(dir, marker), content);
    await ensureCoderRules(target, { config, projectDir: dir, logger });
    return fs.readFileSync(target, "utf8");
  };

  it("gives a JavaScript project on main the JS section", async () => {
    const text = await render("package.json", "{}", { base_branch: "main" });
    expect(text).toContain("origin/main");
    expect(text).toContain("tests/**/*.test.{js,ts}");
    expect(text).toContain("sonar-project.properties");
    expect(text).toContain("CSS, HTML");
    expect(text).not.toContain("follow the project's own layout");
    expect(text).not.toContain("{{");
  });

  it("gives a Python project on develop neutral rules", async () => {
    const text = await render("pyproject.toml", "", { base_branch: "develop" });
    expect(text).toContain("git rebase origin/develop");
    expect(text).toContain("Tests follow the project's own layout and runner; do not move them.");
    expect(text).not.toMatch(/\bmain\b|\*\.test\.js|vitest|include:|CSS|HTML|sonar|feat\/|\{\{/i);
    expect(text).toMatch(/Environment isolation/);
  });

  it("never overwrites an existing coder-rules.md", async () => {
    fs.writeFileSync(target, "# mine\n");
    await ensureCoderRules(target, { config: {}, projectDir: dir, logger });
    expect(fs.readFileSync(target, "utf8")).toBe("# mine\n");
  });
});
