/**
 * KJC-BUG-0544 (#3788): a file the repo marks `linguist-generated` in
 * .gitattributes (the standard GitHub reads) is nobody's code: it leaves the
 * Sonar requirement and the line budget. Git answers, .gitattributes is never
 * parsed by hand. A failing git is said loudly and exempts nothing.
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

import { GENERATED_CONFIG_FILES } from "../harden/config-templates.js";
import { AI_RULES } from "./loc-budget.js";

const run = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

/**
 * @param {string[]} files repo-relative paths
 * @param {{cwd?: string, cached?: boolean, source?: string, runner?: (cwd: string, args: string[]) => string, warn?: (msg: string) => void}} [opts]
 *   `cached` reads the staged index's attributes (the pre-commit path); `source`
 *   reads those of that tree (git >= 2.40; an older git fails and exempts nothing).
 * @returns {Set<string>} the files whose linguist-generated is set or true
 */
export function linguistGenerated(files, { cwd = process.cwd(), cached = false, source, runner = run, warn = (msg) => process.stderr.write(`${msg}\n`) } = {}) {
  const generated = new Set();
  if (!files?.length) return generated;
  const cachedFlag = cached ? ["--cached"] : [];
  const from = source ? ["--source", source] : cachedFlag;
  try {
    const out = runner(cwd, ["check-attr", ...from, "-z", "linguist-generated", "--", ...files]);
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

// An allow-list, not a code list: an extension nobody thought of (SQL, CSS, HTML) must stay visible.
const DATA_FILE = /\.(?:json|jsonl|ndjson|geojson|csv|tsv|txt)$/i;

// Only data may be summarized, and never AI rules (at any depth) or kj's own configs.
const alwaysShown = (file) => !DATA_FILE.test(file) || GENERATED_CONFIG_FILES.has(basename(file))
  || AI_RULES.some((re) => re.test(file) || re.test(basename(file)));

/**
 * HU-4976: what the reviewer prompt may summarize on the repo's word. Only the
 * BASE tree's attributes count, so a diff cannot hide its own files.
 * @returns {string[]}
 */
export function generatedForPrompt(files, { base, ...opts } = {}) {
  if (!base) return [];
  return [...linguistGenerated((files ?? []).filter((f) => !alwaysShown(f)), { ...opts, source: base })];
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
