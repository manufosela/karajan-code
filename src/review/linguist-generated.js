/**
 * KJC-BUG-0544 (#3788): a file the repo marks `linguist-generated` in
 * .gitattributes (the standard GitHub reads) is nobody's code: it leaves the
 * Sonar requirement and the line budget. Git answers, .gitattributes is never
 * parsed by hand. A failing git is said loudly and exempts nothing.
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

import { GENERATED_CONFIG_FILES } from "../harden/config-templates.js";

const run = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

/**
 * @param {string[]} files repo-relative paths
 * @param {{cwd?: string, cached?: boolean, runner?: (cwd: string, args: string[]) => string, warn?: (msg: string) => void}} [opts]
 *   `cached` reads the staged index's attributes (the pre-commit path).
 * @returns {Set<string>} the files whose linguist-generated is set or true
 */
export function linguistGenerated(files, { cwd = process.cwd(), cached = false, runner = run, warn = (msg) => process.stderr.write(`${msg}\n`) } = {}) {
  const generated = new Set();
  if (!files?.length) return generated;
  try {
    const out = runner(cwd, ["check-attr", ...(cached ? ["--cached"] : []), "-z", "linguist-generated", "--", ...files]);
    const parts = out.split("\0");
    // Triplets: path NUL attribute NUL value NUL.
    for (let i = 0; i + 2 < parts.length; i += 3) {
      if (parts[i + 2] === "set" || parts[i + 2] === "true") generated.add(parts[i]);
    }
  } catch (err) {
    warn(`⚠ linguist-generated: git check-attr failed (${String(err.message).split("\n")[0]}); no file is treated as generated`);
    return new Set();
  }
  return generated;
}

// kj's marker lines: a comment holding only the marker, with nothing of code before it.
const OPEN = /^\s*(?:\/\/|#|<!--|\/\*)\s*>>> kj:managed:([\w-]+)\b/;
const CLOSE = /^\s*(?:\/\/|#|<!--|\/\*)\s*<<< kj:managed:([\w-]+)\b/;

/** Nothing but kj's managed blocks: outside them, only blank lines. */
function allKjManaged(text) {
  if (typeof text !== "string") return false;
  let open = null;
  let blocks = 0;
  for (const line of text.split("\n")) {
    if (open) {
      if (CLOSE.exec(line)?.[1] === open) { open = null; blocks += 1; }
    } else if (OPEN.test(line)) {
      open = OPEN.exec(line)[1];
    } else if (line.trim() !== "") {
      return false;
    }
  }
  return open === null && blocks > 0;
}

/**
 * KJC-BUG-0612: what nobody wrote, as the review gate judges it: the files marked
 * linguist-generated and a config kj harden writes (by its name) made of kj's managed
 * block alone. A config of that name written by hand, or with lines outside kj's block,
 * stays under the gates. `textOf(file)` gives the file as the reviewed diff leaves it
 * (the review gate's resultingContent); by default, the staged text.
 * @returns {Promise<Set<string>>}
 */
export async function generatedFiles(files, opts = {}) {
  const { cwd = process.cwd(), runner = run } = opts;
  const staged = (file) => { try { return runner(cwd, ["show", `:${file}`]); } catch { return null; } };
  const { textOf = staged } = opts;
  const generated = linguistGenerated(files, opts);
  for (const file of files ?? []) {
    if (GENERATED_CONFIG_FILES.has(basename(file)) && allKjManaged(await textOf(file))) generated.add(file);
  }
  return generated;
}
