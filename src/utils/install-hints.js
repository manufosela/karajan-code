// Platform-aware install hints for external tools that `kj audit` /
// `kj webperf` use (semgrep, osv-scanner, lighthouse).
//
// `kj doctor` calls these to render hint strings ("Install with:
// pipx install semgrep") that match what's actually available on the
// user's machine, rather than a generic "see docs" message. The same
// metadata drives `kj install-tools` (HU2) — it decides which package
// manager to invoke per tool.
//
// We probe each package manager once with `which`/`where`-style checks
// and cache the result for the lifetime of the process.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * @typedef {"pipx"|"brew"|"go"|"npm"|"pip"|"apt"|"dnf"|"choco"|"scoop"|"docker"} PackageManager
 */

/** @type {Record<PackageManager, boolean>|null} */
let cachedAvailability = null;

const PROBES = [
  ["pipx", ["--version"]],
  ["brew", ["--version"]],
  ["go", ["version"]],
  ["npm", ["--version"]],
  ["pip", ["--version"]],
  ["apt", ["--version"]],
  ["dnf", ["--version"]],
  ["choco", ["--version"]],
  ["scoop", ["--version"]],
  ["docker", ["--version"]],
];

async function probeOne(bin, args) {
  try {
    await execFileAsync(bin, args, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect which package managers are reachable on PATH. Cached on first
 * call. Exported for tests; production callers go through getInstallHint.
 */
export async function detectPackageManagers() {
  if (cachedAvailability) return cachedAvailability;
  const entries = await Promise.all(
    PROBES.map(async ([bin, args]) => [bin, await probeOne(bin, args)]),
  );
  cachedAvailability = Object.fromEntries(entries);
  return cachedAvailability;
}

/** Test helper — reset the cache between unit cases. */
export function resetPackageManagerCache() {
  cachedAvailability = null;
}

/**
 * Returns the install command for a tool, preferring the highest-priority
 * package manager available on the current system.
 *
 * The order encodes our recommendation when multiple managers can install
 * the same tool. We prefer isolated installs (pipx, brew) over global
 * `pip install` so we don't pollute the user's site-packages.
 *
 * @param {"semgrep"|"osv-scanner"|"lighthouse"|"docker"} tool
 * @param {Record<PackageManager, boolean>} [available] — pre-computed availability; if omitted, detects.
 * @returns {Promise<{ command: string|null, manager: PackageManager|null, manualUrl: string }>}
 */
export async function getInstallHint(tool, available = null) {
  const avail = available || (await detectPackageManagers());
  const candidates = INSTALL_CANDIDATES[tool] || [];
  for (const { manager, command } of candidates) {
    if (avail[manager]) return { command, manager, manualUrl: MANUAL_URLS[tool] };
  }
  // Nothing matched — suggest a recipe that actually works on this system.
  // KJC-BUG-0120 (issue #1256): distro-aware fallbacks first (PEP 668 makes
  // the generic pip bootstrap fail on Debian/Ubuntu); these are display-only
  // (manager: null), never auto-run — sudo stays in the user's hands.
  for (const { when, command } of DISTRO_FALLBACKS[tool] || []) {
    if (avail[when]) return { command, manager: null, manualUrl: MANUAL_URLS[tool] };
  }
  const first = candidates[0];
  return {
    command: first ? first.command : null,
    manager: null,
    manualUrl: MANUAL_URLS[tool],
  };
}

const DISTRO_FALLBACKS = {
  semgrep: [
    { when: "apt", command: "sudo apt update && sudo apt install -y pipx && pipx install semgrep" },
    { when: "dnf", command: "sudo dnf install -y pipx && pipx install semgrep" },
  ],
};

const INSTALL_CANDIDATES = {
  semgrep: [
    { manager: "pipx", command: "pipx install semgrep" },
    { manager: "brew", command: "brew install semgrep" },
    { manager: "pip", command: "pip install semgrep" },
  ],
  "osv-scanner": [
    // The module root has no main package — the binary lives in the cmd/
    // subpackage, and since v2 the module path carries the /v2 suffix.
    // `go install github.com/google/osv-scanner@latest` resolves the module
    // (v1.x) but fails with "does not contain package" (KJC-BUG-0105).
    { manager: "go", command: "go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest" },
    { manager: "brew", command: "brew install osv-scanner" },
  ],
  lighthouse: [
    { manager: "npm", command: "npm install -g lighthouse" },
  ],
  docker: [
    // Docker Desktop / Engine cannot be installed by a package manager
    // reliably across platforms — always point users to the official docs.
    // Listing brew anyway as a hint for macOS users.
    { manager: "brew", command: "brew install --cask docker" },
  ],
};

const MANUAL_URLS = {
  semgrep: "https://semgrep.dev/docs/getting-started",
  "osv-scanner": "https://google.github.io/osv-scanner/installation/",
  lighthouse: "https://github.com/GoogleChrome/lighthouse#using-the-cli",
  docker: "https://docs.docker.com/get-docker/",
  git: "https://git-scm.com/downloads",
};

// git is a `kj doctor` *required* tool. Unlike the audit tools it is installed
// through the OS package manager, and on Linux that needs root — so the plan
// carries a `needsSudo` flag and the caller runs those through the interactive
// (tty-inherited) path, where sudo prompts the user directly and kj never sees
// the password. brew/scoop/choco install at user scope, no sudo.
const GIT_CANDIDATES = [
  { manager: "brew", command: "brew install git", needsSudo: false },
  { manager: "apt", command: "sudo apt-get install -y git", needsSudo: true },
  { manager: "dnf", command: "sudo dnf install -y git", needsSudo: true },
  { manager: "choco", command: "choco install git -y", needsSudo: false },
  { manager: "scoop", command: "scoop install git", needsSudo: false },
];

/**
 * Pick a git install plan for the current machine. Returns a manual plan
 * (command null + URL) when no supported package manager is present.
 *
 * @param {Record<PackageManager, boolean>} available
 * @returns {{ command: string|null, manager: PackageManager|null, needsSudo: boolean, manualUrl: string }}
 */
export function gitInstallPlan(available = {}) {
  for (const { manager, command, needsSudo } of GIT_CANDIDATES) {
    if (available[manager]) return { command, manager, needsSudo, manualUrl: MANUAL_URLS.git };
  }
  return { command: null, manager: null, needsSudo: false, manualUrl: MANUAL_URLS.git };
}

/**
 * Tools whose hint depends on the project stack. lighthouse is only
 * relevant for frontend projects; suppressing the hint elsewhere keeps
 * `kj doctor` output free of irrelevant noise.
 *
 * @param {string} tool
 * @param {Object} stack — shape returned by detectProjectStack()
 */
export function appliesToStack(tool, stack) {
  if (tool === "lighthouse") {
    if (!stack) return false;
    return Boolean(stack.isFrontend || stack.isFullstack);
  }
  // semgrep, osv-scanner, docker, sonar — always relevant.
  return true;
}
