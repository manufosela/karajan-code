/**
 * advisory — per-artifact comparison engine for `kj harden` advisory mode
 * (KJC-TSK-0565, épica KJC-PCS-0060). For each artifact harden manages it
 * classifies the repo state: MISSING (no file nor equivalent), KJ_MANAGED (a
 * kj:managed block, up to date or outdated vN) or USER_OWNED (the user's own,
 * possibly in another format). Read-only; never writes or prints. The result
 * feeds `--report` (Advisory B) / `--interactive` (Advisory C). Per-type
 * improvement heuristics for USER_OWNED land in the follow-up slice (PR2).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { findManagedBlock } from "../utils/managed-markers.js";
import { CONFIGS_BY_LANGUAGE, UNIVERSAL_CONFIGS } from "./config-templates.js";
import { detectStackRoots } from "./stack-roots.js";

const BLOCK_VERSION = 1; // current version every markered config ships at

// Other filenames/formats for the same artifact, so kj never reports a false
// "missing". `pkgKey` is a package.json field that can hold inline config.
const EQUIVALENTS = {
  commitlint: { files: [".commitlintrc", ".commitlintrc.js", ".commitlintrc.json", ".commitlintrc.yaml"], pkgKey: "commitlint" },
  eslint: { files: ["eslint.config.mjs", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yaml"], pkgKey: "eslintConfig" },
  prettier: { files: [".prettierrc", ".prettierrc.js", ".prettierrc.yaml", "prettier.config.js"], pkgKey: "prettier" },
};

// Concrete gains kj's standard would add to a USER_OWNED config, detected by
// substring probes (no AST parse): each probe absent from the user's content
// becomes one improvement. Heuristic by design — conservative, never a false
// "you're missing this" when the signal is clearly present.
const IMPROVEMENTS = {
  eslint: [
    { needle: "no-var", id: "no-var", detail: "bans var (ES2025: const/let)" },
    { needle: "no-restricted-globals", id: "no-legacy-globals", detail: "bans alert/confirm/prompt, escape/unescape" },
    { needle: "no-restricted-properties", id: "no-legacy-apis", detail: "bans document.write, substr" },
  ],
  commitlint: [
    { needle: "header-max-length", id: "header-max-length", detail: "caps the commit header at 100 chars" },
    { needle: "subject-case", id: "subject-case", detail: "enforces a lowercase subject" },
  ],
  prettier: [{ needle: "printWidth", id: "print-width", detail: "pins printWidth (consistent wrapping)" }],
  editorconfig: [
    { needle: "insert_final_newline", id: "final-newline", detail: "enforces a final newline" },
    { needle: "charset", id: "charset", detail: "pins charset = utf-8" },
    { needle: "trim_trailing_whitespace", id: "trim-trailing", detail: "trims trailing whitespace" },
  ],
};

/** Improvements kj would add to the user's own config for `artifactId`. */
function improvementsFor(artifactId, content) {
  return (IMPROVEMENTS[artifactId] ?? [])
    .filter((probe) => !content.includes(probe.needle))
    .map(({ id, detail }) => ({ id, detail }));
}

/** Build an artifact descriptor from a config-template entry. */
function toArtifact(cfg) {
  const id = cfg.blockId ?? "prettier"; // the only marker-less JSON config is prettier
  return {
    id,
    file: cfg.file,
    blockId: cfg.blockId ?? null,
    currentVersion: cfg.blockId ? BLOCK_VERSION : null,
    equivalents: EQUIVALENTS[id]?.files ?? [],
    pkgKey: EQUIVALENTS[id]?.pkgKey ?? null,
  };
}

/** Locate the user's file for an artifact under `searchDir`; null if absent. */
function findArtifactFile(searchDir, artifact) {
  for (const rel of [artifact.file, ...artifact.equivalents]) {
    if (existsSync(join(searchDir, rel))) return rel;
  }
  if (artifact.pkgKey && existsSync(join(searchDir, "package.json"))) {
    try {
      if (JSON.parse(readFileSync(join(searchDir, "package.json"), "utf8"))[artifact.pkgKey] != null) {
        return `package.json#${artifact.pkgKey}`;
      }
    } catch {
      /* unreadable package.json → not a match */
    }
  }
  return null;
}

/** Read the artifact body, or the JSON of an inline package.json key. */
function readArtifactContent(searchDir, foundAt) {
  const [file, key] = foundAt.split("#");
  const raw = readFileSync(join(searchDir, file), "utf8");
  if (!key) return raw;
  try {
    return JSON.stringify(JSON.parse(raw)[key] ?? null);
  } catch {
    return raw;
  }
}

/** Map a classified state to a recommendation + human rationale. */
function recommend(state) {
  if (state.status === "MISSING") return { recommendation: "install", rationale: `kj would add ${state.file}`, mergeable: true };
  if (state.status === "USER_OWNED") {
    const n = state.improvements?.length ?? 0;
    return n === 0
      ? { recommendation: "keep", rationale: "your own config — already covers the kj standard", mergeable: false }
      : { recommendation: "review", rationale: `your own config — kj could add ${n} improvement(s)`, mergeable: true };
  }
  if (state.upToDate) return { recommendation: "keep", rationale: `managed by kj (v${state.managedVersion}), up to date`, mergeable: false };
  return { recommendation: "update", rationale: `kj v${state.currentVersion} available (you have v${state.managedVersion})`, mergeable: true };
}

/** Classify a single artifact found (or not) under `searchDir`. */
export function classifyArtifact(searchDir, artifact) {
  const foundAt = findArtifactFile(searchDir, artifact);
  const base = { foundAt, managedVersion: null, upToDate: null, improvements: [] };
  let state = { ...base, status: "MISSING" };
  if (foundAt) {
    const content = readArtifactContent(searchDir, foundAt);
    if (artifact.blockId && content.includes(`kj:managed:${artifact.blockId}`)) {
      const { version } = findManagedBlock(content, artifact.blockId);
      state = { ...base, status: "KJ_MANAGED", managedVersion: version, upToDate: version != null && version >= artifact.currentVersion };
    } else {
      state = { ...base, status: "USER_OWNED", improvements: improvementsFor(artifact.id, content) };
    }
  }
  const head = { id: artifact.id, file: artifact.file, currentVersion: artifact.currentVersion };
  return { ...head, ...state, ...recommend({ ...state, ...head }) };
}

/**
 * Compare the whole repo against the kj standard, artifact by artifact:
 * universal configs at the root, then each language's lint config inside its
 * own root (monorepo-aware, mirroring installConfigsForRoots). `minimal`
 * profile ships no config, so there is nothing to compare.
 */
export function compareHarden({ projectDir = process.cwd(), profile = "standard", only = [], exclude = [] } = {}) {
  if (profile === "minimal") return { artifacts: [] };
  const artifacts = UNIVERSAL_CONFIGS.map((cfg) => ({ dir: ".", ...classifyArtifact(projectDir, toArtifact(cfg)) }));
  for (const { dir, language } of detectStackRoots(projectDir, { only, exclude })) {
    const searchDir = dir === "." ? projectDir : join(projectDir, dir);
    for (const cfg of CONFIGS_BY_LANGUAGE[language] ?? []) {
      const res = classifyArtifact(searchDir, toArtifact(cfg));
      artifacts.push({ dir, ...res, foundAt: res.foundAt && dir !== "." ? join(dir, res.foundAt) : res.foundAt });
    }
  }
  return { artifacts };
}

const MARK = { install: "+", update: "↑", review: "~", keep: "✓" };

/**
 * Render a compareHarden() result as human-readable lines (Advisory B). Pure:
 * returns an array of strings, prints nothing. One line per artifact, indented
 * bullets for each improvement, then a one-line tally.
 */
export function formatAdvisoryReport({ artifacts = [] } = {}) {
  if (artifacts.length === 0) return ["kj harden — nothing to compare (minimal profile or empty repo)."];
  const lines = ["kj harden — advisory report (read-only)", ""];
  const tally = { install: 0, update: 0, review: 0, keep: 0 };
  for (const a of artifacts) {
    tally[a.recommendation] = (tally[a.recommendation] ?? 0) + 1;
    const path = a.foundAt ?? (a.dir === "." ? a.file : join(a.dir, a.file));
    lines.push(`  ${MARK[a.recommendation] ?? "·"} ${a.recommendation.padEnd(7)} ${path} — ${a.rationale}`);
    for (const imp of a.improvements ?? []) lines.push(`      • ${imp.detail}`);
  }
  lines.push("", `${artifacts.length} artifact(s) · ${tally.install} missing · ${tally.review} to review · ${tally.update} outdated · ${tally.keep} ok`);
  return lines;
}
