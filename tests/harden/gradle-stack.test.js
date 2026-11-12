import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectStackRoots } from "../../src/harden/stack-roots.js";
import { commandsForLanguage } from "../../src/harden/hook-commands.js";
import { gradleJavaVersion } from "../../src/harden/gradle-commands.js";
import { guidelinesBody } from "../../src/harden/guidelines-templates.js";
import { installWorkflows } from "../../src/harden/workflow-engine.js";
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
  const ktlintAndDetekt = 'plugins {\n  id("org.jlleitschuh.gradle.ktlint") version "12.1.0"\n  id("io.gitlab.arturbosch.detekt") version "1.23.6"\n}\n';

  it("runs the tasks the build declares through an executable wrapper, and no go tools", async () => {
    touch("build.gradle.kts", ktlintAndDetekt);
    touch("gradlew", "#!/bin/sh\n");
    chmodSync(join(root, "gradlew"), 0o755);
    touch("scripts/go.mod", "module helper\n");
    const c = await resolveCmds(root, null);
    expect(c).toEqual({ lint: "./gradlew ktlintCheck detekt", test: "./gradlew test" });
  });

  it("reads plugins applied by alias from the version catalog, and runs gradle when gradlew is not executable", () => {
    touch("build.gradle.kts", "plugins { alias(libs.plugins.ktlint) }\n");
    touch("gradlew", "#!/bin/sh\n");
    touch("gradle/libs.versions.toml", '[plugins]\nktlint = { id = "org.jlleitschuh.gradle.ktlint", version = "12.1.0" }\n');
    expect(commandsForLanguage("gradle", root)).toEqual({ lint: "gradle ktlintCheck", test: "gradle test" });
  });

  it("a catalog plugin or library the build never applies is no lint step", () => {
    touch("build.gradle.kts", "plugins { alias(libs.plugins.kotlin.jvm) }\n");
    touch("gradle/libs.versions.toml", [
      '[libraries]\ndetekt-formatting = { module = "io.gitlab.arturbosch.detekt:detekt-formatting", version = "1.23.6" }',
      '[plugins]\nkotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version = "2.0.21" }',
      'ktlint = { id = "org.jlleitschuh.gradle.ktlint", version = "12.1.0" }',
    ].join("\n"));
    expect(commandsForLanguage("gradle", root)).toEqual({ test: "gradle test" });
  });

  it.each([
    ["static-analysis", "alias(libs.plugins.static.analysis)"],
    ["static_analysis", "alias(libs.plugins.static.analysis) apply false"],
  ])("the alias %s applies through its dotted accessor: %s", (alias, use) => {
    touch("build.gradle", `plugins { ${use} }\n`);
    touch("gradle/libs.versions.toml", `[plugins]\n"${alias}" = "io.gitlab.arturbosch.detekt:1.23.6"\n`);
    expect(commandsForLanguage("gradle", root)).toEqual({ lint: "gradle detekt", test: "gradle test" });
  });

  it("no lint plugin means no lint step, only the tests", () => {
    touch("build.gradle", "plugins { id 'java' }\n");
    expect(commandsForLanguage("gradle", root)).toEqual({ test: "gradle test" });
  });

  it("spotless is the format step", () => {
    touch("build.gradle.kts", 'plugins { id("com.diffplug.spotless") version "6.25.0" }');
    expect(commandsForLanguage("gradle", root)).toEqual({ format: "gradle spotlessCheck", test: "gradle test" });
  });

  it("a root with no build file runs nothing", () => {
    touch("settings.gradle.kts", 'rootProject.name = "x"\n');
    expect(commandsForLanguage("gradle", root)).toEqual({});
  });
});

describe("gradle quality workflow", () => {
  const read = () => readFileSync(join(root, ".github", "workflows", "kj-quality.yml"), "utf8");

  it("sets up the toolchain the build declares, caches gradle and runs the hook commands", () => {
    touch("apps/mobile/build.gradle.kts", 'plugins { id("io.gitlab.arturbosch.detekt") }\nkotlin { jvmToolchain(21) }\n');
    installWorkflows({ projectDir: root, language: "gradle", root: "apps/mobile" });
    const job = yaml.load(read()).jobs.quality;
    expect(job.defaults).toEqual({ run: { "working-directory": "apps/mobile" } });
    const java = { distribution: "temurin", "java-version": "21", cache: "gradle" };
    expect(job.steps[1]).toEqual({ uses: expect.stringMatching(/^actions\/setup-java@[0-9a-f]{40}$/), with: java });
    expect(job.steps.slice(2)).toEqual([{ run: "gradle detekt" }, { run: "gradle test" }]);
  });

  it("reads JavaLanguageVersion.of and defaults to 17", () => {
    touch("build.gradle", "java { toolchain { languageVersion = JavaLanguageVersion.of(11) } }\n");
    expect(gradleJavaVersion(root)).toBe("11");
    touch("build.gradle", "plugins { id 'java' }\n");
    expect(gradleJavaVersion(root)).toBeNull();
    installWorkflows({ projectDir: root, language: "gradle" });
    expect(read()).toContain('java-version: "17"');
  });
});

describe("gradle guidelines", () => {
  it("say Gradle/Kotlin, not Go", () => {
    const body = guidelinesBody("gradle");
    expect(body).toContain("## Gradle / Kotlin");
    expect(body).not.toContain("## Go");
    expect(body).not.toContain("No lint command is inferred");
  });
});
