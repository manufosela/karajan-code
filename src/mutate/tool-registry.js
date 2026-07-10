/**
 * Mutation-tool registry.
 *
 * Maps a detected stack language (see `src/harden/stack-roots.js`) to the
 * mutation-testing runner Karajan drives for it. Unknown or native-mobile
 * languages resolve to an explicit `{ supported: false, reason }` object —
 * never a silent fallback to another tool.
 *
 * `scope` describes how the runner limits mutation to a subset of files, so
 * diff-scoped runs (`kj mutate --since <ref>`) can pass only the changed paths:
 *   - flag:      the CLI flag that accepts the file list
 *   - separator: how multiple paths are joined for that flag
 */

const TOOLS_BY_LANGUAGE = {
  javascript: {
    id: "stryker",
    binary: "stryker",
    installHint: "npm install --save-dev @stryker-mutator/core",
    scope: { flag: "--mutate", separator: "," },
    reportFormat: "json",
  },
  typescript: {
    id: "stryker",
    binary: "stryker",
    installHint: "npm install --save-dev @stryker-mutator/core",
    scope: { flag: "--mutate", separator: "," },
    reportFormat: "json",
  },
  python: {
    id: "mutmut",
    binary: "mutmut",
    installHint: "pip install mutmut",
    scope: { flag: "--paths-to-mutate", separator: "," },
    reportFormat: "json",
  },
  php: {
    id: "infection",
    binary: "infection",
    installHint: "composer require --dev infection/infection",
    scope: { flag: "--filter", separator: "," },
    reportFormat: "json",
  },
  go: {
    id: "go-mutesting",
    binary: "go-mutesting",
    installHint: "go install github.com/avito-tech/go-mutesting/cmd/go-mutesting@latest",
    scope: { flag: "", separator: " " },
    reportFormat: "json",
  },
  java: {
    id: "pitest",
    binary: "pitest",
    installHint: "add org.pitest:pitest-maven (Maven) or gradle-pitest-plugin",
    scope: { flag: "targetClasses", separator: "," },
    reportFormat: "json",
  },
};

const UNSUPPORTED_REASONS = {
  swift: "Swift (iOS) has no mutation runner wired into Karajan",
  kotlin: "Kotlin (Android) has no mutation runner wired into Karajan",
};

function normalize(language) {
  if (typeof language !== "string") return "";
  return language.trim().toLowerCase();
}

/**
 * @param {string} language - language id from `detectStackRoots`
 * @returns {{supported: true, id, binary, language, installHint, scope, reportFormat}
 *          | {supported: false, language, reason: string}}
 */
export function getMutationTool(language) {
  const key = normalize(language);
  const tool = TOOLS_BY_LANGUAGE[key];
  if (tool) {
    return { supported: true, language: key, ...tool };
  }
  const reason =
    UNSUPPORTED_REASONS[key] ??
    `no mutation-testing tool is registered for language "${key || "(none)"}"`;
  return { supported: false, language: key, reason };
}

/** @returns {string[]} languages with a registered mutation tool */
export function listSupportedLanguages() {
  return Object.keys(TOOLS_BY_LANGUAGE);
}
