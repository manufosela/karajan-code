/**
 * KJC-TSK-1388 (ADR 0045): the rules as kj init and kj doctor show them, built from the
 * same registry and project layer as `kj gates`.
 */
import { resolveRules, formatRules } from "./registry.js";
import { projectSignals } from "./effective.js";

/** Every rule resolved, with what the project says against a fixed one and settings gone stale. */
export function resolvedWithSignals({ config, projectDir, signals = projectSignals }) {
  const { project, conflicts, stale } = signals({ projectDir, config });
  return { ...resolveRules(config, { project }), conflicts, stale };
}

/** KJC-BUG-0510: the project's resolved commit-convention (conventional, project or free). */
export function commitConventionOf({ config, projectDir, signals }) {
  return resolvedWithSignals({ config, projectDir, signals }).adjustable.find((r) => r.id === "commit-convention").value;
}

const COMMIT_PHRASES = {
  conventional: "Conventional Commits",
  project: "the project's own commitlint convention",
  free: "the commit style of the project's history",
};

/** How the text kj writes into AGENTS.md/CLAUDE.md names a commit-convention value. */
export function commitConventionPhrase(value) {
  const phrase = COMMIT_PHRASES[value];
  if (!phrase) throw new Error(`unknown commit-convention "${value}"`);
  return phrase;
}

/** The lines kj init closes with. */
export function rulesAtClose({ config, projectDir, signals }) {
  return ["", ...formatRules(resolvedWithSignals({ config, projectDir, signals })).split("\n")];
}
