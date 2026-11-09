import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectStackRoots } from "../../src/harden/stack-roots.js";
import { commandsForLanguage } from "../../src/harden/hook-commands.js";
import { guidelinesBody } from "../../src/harden/guidelines-templates.js";
import { resolveCmds } from "../../src/commands/harden.js";

let root;
const touch = (rel, content = "") => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-gradle-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("gradle stack detection", () => {
  it.each(["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "gradlew"])(
    "%s at the root is gradle, even with a go module under scripts/",
    (marker) => {
      touch(marker);
      touch("scripts/go.mod", "module helper\n");
      touch("scripts/tool.go", "package main\n");
      expect(detectStackRoots(root)[0]).toEqual({ dir: ".", language: "gradle" });
    },
  );

  it("a root go.mod is still go", () => {
    touch("go.mod", "module x\n");
    expect(detectStackRoots(root)).toEqual([{ dir: ".", language: "go" }]);
  });

  it("stray .go files with no go.mod are not go", () => {
    touch("scripts/tool.go", "package main\n");
    expect(detectStackRoots(root)).toEqual([]);
  });
});

describe("gradle hook commands", () => {
  it("infers no lint or format step, even when the build mentions spotless, and no go tools", async () => {
    touch("build.gradle.kts", 'plugins { id("com.diffplug.spotless") version "6.25.0" }');
    touch("scripts/go.mod", "module helper\n");
    const c = await resolveCmds(root, null);
    expect(c.lint).toBeUndefined();
    expect(c.format).toBeUndefined();
    expect(JSON.stringify(c)).not.toMatch(/go vet|gofmt/);
  });

  it("the gradle stack maps to an empty command set", () => {
    expect(commandsForLanguage("gradle", root)).toEqual({});
  });
});

describe("gradle guidelines", () => {
  it("say Gradle/Kotlin, not Go", () => {
    const body = guidelinesBody("gradle");
    expect(body).toContain("## Gradle / Kotlin");
    expect(body).not.toContain("## Go");
  });
});
