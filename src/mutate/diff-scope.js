/**
 * Diff-scoping for mutation testing. Translates a git range (`--since <ref>`)
 * into changed source files + line ranges, then into the scope flags of the
 * tool resolved by the registry (`src/mutate/tool-registry.js`). Mutating only
 * what the coder just touched is what makes mutation testing cheap and useful.
 * The git call is injectable so the pure logic is testable without a repo.
 */

import { runCommand } from "../utils/process.js";
import { getMutationTool } from "./tool-registry.js";

const SOURCE_EXTENSIONS = {
  javascript: [".js", ".mjs", ".cjs", ".jsx"],
  typescript: [".ts", ".tsx"],
  python: [".py"],
  php: [".php"],
  go: [".go"],
  java: [".java"],
};

const HUNK = /^@@ -\S+ \+(\d+)(?:,(\d+))?/;

/**
 * Parse `git diff --unified=0` into new-side line ranges per file. Deleted
 * files (`+++ /dev/null`) are omitted — there is nothing to mutate.
 * @returns {Record<string, Array<[number, number]>>}
 */
export function parseUnifiedDiff(diffText) {
  const ranges = {};
  let current = null;
  for (const line of String(diffText || "").split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      current = target === "/dev/null" ? null : target.replace(/^b\//, "");
      if (current) ranges[current] ??= [];
      continue;
    }
    if (!current) continue;
    const match = HUNK.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) ranges[current].push([start, start + count - 1]);
  }
  return ranges;
}

/** @returns {string[]} source extensions for a language ([] if unsupported) */
export function sourceExtensions(language) {
  return SOURCE_EXTENSIONS[language] ?? [];
}

/** Keep only files whose extension belongs to the language's source set. */
export function filterSourceFiles(files, language) {
  const exts = sourceExtensions(language);
  if (exts.length === 0) return [];
  return files.filter((file) => exts.some((ext) => file.endsWith(ext)));
}

/**
 * Build the tool's scope arguments for the changed source files. `ranges`
 * (per-file changed line ranges) is only consumed by Stryker (`path:start-end`).
 * @param {{language: string, files: string[], ranges?: Record<string, Array<[number, number]>>}} params
 */
export function buildScope({ language, files, ranges }) {
  const tool = getMutationTool(language);
  if (!tool.supported) {
    return { supported: false, reason: tool.reason, empty: true, args: [] };
  }
  const source = filterSourceFiles(files ?? [], language);
  if (source.length === 0) {
    return { supported: true, tool: tool.id, empty: true, targets: [], args: [] };
  }
  const targets =
    tool.id === "stryker" && ranges
      ? source.flatMap((file) =>
          (ranges[file] ?? [[undefined, undefined]]).map(([start, end]) =>
            start === undefined ? file : `${file}:${start}-${end}`,
          ),
        )
      : source;
  const value = targets.join(tool.scope.separator);
  const args = tool.scope.flag ? [tool.scope.flag, value] : [value];
  return { supported: true, tool: tool.id, empty: false, targets, args };
}

/**
 * Fetch the diff for `since..toRef` and compute the mutation scope. `run` is
 * the injectable git runner (defaults to `runCommand`).
 * @param {{since: string, language: string, toRef?: string, run?: Function}} params
 */
export async function getDiffScope({ since, language, toRef = "HEAD", staged = false, run = runCommand }) {
  // MUT-A (KJC-TSK-0716): staged=true scopea al ÍNDICE (git diff --cached) —
  // lo que el review gate evalúa. since..HEAD con since=HEAD sería un diff
  // VACÍO y el pre-gate no mutaría nada (catch de codex, agravado).
  const args = staged ? ["diff", "--unified=0", "--cached"] : ["diff", "--unified=0", `${since}..${toRef}`];
  const result = await run("git", args).catch(
    () => null,
  );
  if (!result || result.exitCode !== 0) {
    return { supported: true, empty: true, targets: [], args: [] };
  }
  const ranges = parseUnifiedDiff(result.stdout);
  return buildScope({ language, files: Object.keys(ranges), ranges });
}
