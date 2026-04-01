/**
 * Deterministic compression dispatcher.
 * Tries known patterns in order of specificity; returns original text if nothing matches.
 */
import * as bashGit from "./bash-git.js";
import * as bashTest from "./bash-test.js";
import * as bashBuild from "./bash-build.js";
import * as bashInfra from "./bash-infra.js";
import * as bashPkg from "./bash-pkg.js";
import * as bashMisc from "./bash-misc.js";
import * as grepMod from "./grep.js";
import * as readMod from "./read.js";
import * as globMod from "./glob.js";

/** Compressors keyed by tool name hint. */
const TOOL_COMPRESSORS = {
  Grep: grepMod,
  Read: readMod,
  Glob: globMod
};

/** Bash compressors tried in order of specificity. */
const BASH_COMPRESSORS = [
  bashGit,
  bashTest,
  bashBuild,
  bashInfra,
  bashPkg,
  bashMisc
];

/**
 * Compress tool output deterministically.
 * @param {string} text - raw tool output
 * @param {string} [toolName] - tool name hint (e.g. "Bash", "Grep", "Read", "Glob")
 * @returns {{ text: string, compressed: boolean }}
 */
export function compressDeterministic(text, toolName = "") {
  if (!text || typeof text !== "string") return { text: text ?? "", compressed: false };

  // Direct tool match
  const directCompressor = TOOL_COMPRESSORS[toolName];
  if (directCompressor && directCompressor.looksLike(text)) {
    return { text: directCompressor.compact(text), compressed: true };
  }

  // For Bash or unknown tools, try all bash compressors in order
  if (!toolName || toolName === "Bash") {
    for (const compressor of BASH_COMPRESSORS) {
      if (compressor.looksLike(text)) {
        return { text: compressor.compact(text), compressed: true };
      }
    }
  }

  // No pattern matched
  return { text, compressed: false };
}
