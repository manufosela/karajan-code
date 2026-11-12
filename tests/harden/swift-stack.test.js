import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectStackRoots } from "../../src/harden/stack-roots.js";
import { commandsForLanguage } from "../../src/harden/hook-commands.js";
import { guidelinesBody } from "../../src/harden/guidelines-templates.js";
import { hookBody } from "../../src/harden/hook-templates.js";
import { installWorkflows } from "../../src/harden/workflow-engine.js";
import { resolveHookCmds } from "../../src/commands/harden.js";

let root;
const touch = (rel, content = "") => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
};
const XCODEGEN = "name: App\ntargets:\n  App:\n    type: application\n";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-swift-"));
  mkdirSync(join(root, ".git"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("swift stack detection", () => {
  it.each([["Package.swift", "", ["swift"]], ["App.xcodeproj/x", "", ["swift"]], ["project.yml", "name: x\n", []]])(
    "%s at the root: %s",
    (file, content, languages) => {
      touch(file, content);
      expect(detectStackRoots(root)).toEqual(languages.map((language) => ({ dir: ".", language })));
    },
  );

  it("an XcodeGen project.yml with targets is swift three levels down, beside a gradle root", () => {
    touch("apps/mobile/build.gradle.kts", "");
    touch("apps/mobile/iosApp/project.yml", XCODEGEN);
    const found = detectStackRoots(root).map(({ dir, language }) => `${dir}:${language}`);
    expect(found).toEqual(["apps/mobile:gradle", "apps/mobile/iosApp:swift"]);
  });
});

describe("swift hook commands and guidelines", () => {
  it("guidelines have a swift entry", () => expect(guidelinesBody("swift")).toContain("## Swift"));

  it("SwiftPM runs swift test, and lints only with a .swiftlint.yml", () => {
    touch("Package.swift");
    expect(commandsForLanguage("swift", root)).toEqual({ test: "swift test" });
    touch(".swiftlint.yml", "disabled_rules: []\n");
    expect(commandsForLanguage("swift", root)).toEqual({ lint: "swiftlint lint --strict", test: "swift test" });
  });

  it("XcodeGen lints with the repo's .swiftlint.yml and says why it runs no tests", () => {
    touch(".swiftlint.yml");
    touch("ios/project.yml", XCODEGEN);
    touch("ios/.swiftformat", "--indent 4\n");
    expect(commandsForLanguage("swift", join(root, "ios"))).toEqual({
      lint: "swiftlint lint --strict --config ../.swiftlint.yml",
      format: "swiftformat --lint .",
      testNote: expect.stringContaining("xcodebuild needs a scheme and a simulator"),
    });
  });

  it("the pre-push hook says why an Xcode root runs no tests", async () => {
    touch("package.json", JSON.stringify({ scripts: { test: "vitest" } }));
    touch("ios/project.yml", XCODEGEN);
    const cmds = await resolveHookCmds(root, detectStackRoots(root));
    expect(hookBody("pre-push", cmds)).toMatch(/# ios \(swift\): no test command for this stack root: .*xcodebuild/);
    const alone = await resolveHookCmds(join(root, "ios"), [{ dir: ".", language: "swift" }]);
    expect(hookBody("pre-push", alone)).toContain("# No test step for an Xcode project: xcodebuild needs");
  });
});

describe("swift quality workflow", () => {
  const read = () => readFileSync(join(root, ".github", "workflows", "kj-quality.yml"), "utf8");

  it("runs on macOS in the root's dir and installs only the tools whose step exists", () => {
    touch(".swiftlint.yml");
    touch("Sources/Package.swift");
    installWorkflows({ projectDir: root, language: "swift", root: "Sources" });
    const job = yaml.load(read()).jobs.quality;
    expect(job["runs-on"]).toBe("macos-latest");
    expect(job.defaults).toEqual({ run: { "working-directory": "Sources" } });
    const runs = job.steps.slice(1).map((s) => s.run);
    expect(runs).toEqual(["brew install swiftlint", "swiftlint lint --strict --config ../.swiftlint.yml", "swift test"]);
  });
});
