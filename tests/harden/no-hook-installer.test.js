import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// KJC-BUG-0417: a git-hook installer declared in package.json runs on every
// npm install, writes into core.hooksPath (.karajan/hooks) and wipes the
// governance hooks. The governance pre-commit already lints and formats.
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const INSTALLERS = ["simple-git-hooks", "husky", "lefthook", "pre-commit"];

describe("repo package.json declares no git-hook installer", () => {
  it.each(INSTALLERS)("%s is neither a dependency nor a config block", (name) => {
    expect(pkg.dependencies?.[name]).toBeUndefined();
    expect(pkg.devDependencies?.[name]).toBeUndefined();
    expect(pkg[name]).toBeUndefined();
  });
});
