/**
 * KJC-BUG-0544 (#3788): a file the repo marks `linguist-generated` in
 * .gitattributes (the standard GitHub reads) is nobody's code: it leaves the
 * Sonar requirement and the line budget. Git answers, .gitattributes is never
 * parsed by hand. A failing git is said loudly and exempts nothing.
 */
import { execFileSync } from "node:child_process";

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
