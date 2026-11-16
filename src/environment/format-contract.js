/**
 * KJC-BUG-0604 (ADR accepted 15-nov): what kj generates passes the repo's own formatter. A repo
 * whose pre-commit runs prettier --check refused the first contract commit, since kj's files
 * (AGENTS.md, .gemini/settings.json, commitlint.config.js) were not prettier-clean for its config.
 * With prettier installed in the repo, kj formats exactly the contract files it generated, with
 * that prettier and that config, before the review and the commit. The sealed files keep the
 * bytes kj wrote: the seal and CI judge them by hash and by kj's own rendering.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const KEEP_AS_WRITTEN = [".karajan/", ".github/workflows/"];

/** The prettier the repo installed, or null. */
export const repoPrettier = (projectDir) => {
  const bin = join(projectDir, "node_modules", ".bin", "prettier");
  return existsSync(bin) ? bin : null;
};

/**
 * @param {{projectDir: string, files: string[], env?: object}} opts files relative to projectDir
 * @returns {{formatted: string[], error?: string}} error: the formatter's own last line
 */
export function formatWithRepoPrettier({ projectDir, files, env = process.env }) {
  const prettier = repoPrettier(projectDir);
  const targets = files.filter((f) => !KEEP_AS_WRITTEN.some((p) => f.startsWith(p)) && existsSync(join(projectDir, f)));
  if (!prettier || targets.length === 0) return { formatted: [] };
  try {
    execFileSync(prettier, ["--write", "--ignore-unknown", "--log-level", "warn", "--", ...targets], { cwd: projectDir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { formatted: targets };
  } catch (err) {
    const last = `${err.stdout ?? ""}\n${err.stderr ?? err.message}`.split("\n").map((l) => l.trim()).findLast(Boolean);
    return { formatted: [], error: last ?? "prettier failed" };
  }
}
