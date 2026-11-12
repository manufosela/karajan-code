// HU-4067: Swift commands for `kj harden` hooks and its Quality workflow, inferred from what the repo
// declares, never invented: SwiftLint with a `.swiftlint.yml` in the root or an ancestor up to the repo
// root, SwiftFormat with the root's `.swiftformat`, `swift test` only for SwiftPM. Nothing is executed.
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const SWIFTLINT_CONFIG = ".swiftlint.yml";
const XCODE_TEST_NOTE = "an Xcode project: xcodebuild needs a scheme and a simulator, out of scope";

/** The dir and its ancestors up to the repo root (the first holding .git); just the dir outside a repo. */
function upToRepoRoot(dir) {
  const chain = [dir];
  for (let cur = dir; !existsSync(join(cur, ".git")); cur = dirname(cur)) {
    if (dirname(cur) === cur) return [dir];
    chain.push(dirname(cur));
  }
  return chain;
}

/** `swiftlint lint --strict`, pointed at the nearest config when it is not the root's own; null without one. */
function swiftlintCommand(dir) {
  const holder = upToRepoRoot(dir).find((d) => existsSync(join(d, SWIFTLINT_CONFIG)));
  if (!holder) return null;
  return holder === dir ? "swiftlint lint --strict" : `swiftlint lint --strict --config ${relative(dir, join(holder, SWIFTLINT_CONFIG))}`;
}

/** The lint/format/test commands a Swift root declares; an Xcode root carries why it has no test. {} without a dir. */
export function swiftCommands(dir) {
  if (!dir) return {};
  const lint = swiftlintCommand(dir);
  return {
    ...(lint && { lint }),
    ...(existsSync(join(dir, ".swiftformat")) && { format: "swiftformat --lint ." }),
    ...(existsSync(join(dir, "Package.swift")) ? { test: "swift test" } : { testNote: XCODE_TEST_NOTE }),
  };
}

/** The inputs for qualityWorkflowFor's swift options. */
export function swiftInputs({ appDir }) {
  const { lint = null, format = null, test = null } = swiftCommands(appDir);
  return { options: { swift: { lint, format, test } } };
}
