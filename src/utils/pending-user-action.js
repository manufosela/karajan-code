/**
 * Stop-on-sudo policy (KJC-TSK-0659). When a tool cannot be installed
 * automatically (sudo needed, no package-manager route, or the attempt
 * failed), kj must NOT continue degraded — a RAG with 0 chunks because
 * Docker was missing helps nobody. Instead: emit ONE block with the exact
 * commands for this machine's OS and exit with a distinctive code so a
 * driving agent stops, shows the block, and waits for the user.
 */

export const PENDING_EXIT_CODE = 3;

const PENDING = new Set(["manual", "failed", "needs-user"]);

// Exact per-OS commands for the tools kj cannot install unattended.
// Multiple lines when the route depends on the distro/package manager.
const OS_COMMANDS = {
  docker: {
    linux: ["sudo apt-get install -y docker.io   # Debian/Ubuntu", "sudo dnf install -y docker          # Fedora/RHEL"],
    darwin: ["brew install --cask docker   # Docker Desktop, then open it once"],
    win32: ["winget install Docker.DockerDesktop", "wsl --install   # if WSL2 is not set up yet"],
  },
  git: {
    linux: ["sudo apt-get install -y git   # Debian/Ubuntu", "sudo dnf install -y git        # Fedora/RHEL"],
    darwin: ["brew install git   # or: xcode-select --install"],
    win32: ["winget install Git.Git"],
  },
  semgrep: {
    linux: ["python3 -m pip install --user semgrep   # or: pipx install semgrep"],
    darwin: ["brew install semgrep"],
    win32: ["python -m pip install --user semgrep"],
  },
  "osv-scanner": {
    linux: ["go install github.com/google/osv-scanner/v2/cmd/osv-scanner@v2   # or download from GitHub releases"],
    darwin: ["brew install osv-scanner"],
    win32: ["winget install Google.OSVScanner   # or download from GitHub releases"],
  },
  lighthouse: {
    linux: ["npm install -g lighthouse"],
    darwin: ["npm install -g lighthouse"],
    win32: ["npm install -g lighthouse"],
  },
  ollama: {
    linux: ["curl -fsSL https://ollama.com/install.sh | sh   # official installer (uses sudo)", "ollama pull nomic-embed-text"],
    darwin: ["brew install ollama && brew services start ollama", "ollama pull nomic-embed-text"],
    win32: ["winget install Ollama.Ollama", "ollama pull nomic-embed-text"],
  },
};

/** Exact commands to install `tool` on `platform` (empty when unknown). */
export function osCommandsFor(tool, platform = process.platform) {
  return OS_COMMANDS[tool]?.[platform] ?? [];
}

/**
 * Results that require the USER's hands. `manual`/`failed`/`needs-user`
 * always qualify; `declined` only when nobody actually declined — a non-TTY
 * run without --yes auto-answers the default, which for sudo installs is
 * "no". A real interactive decline stays the user's own decision.
 */
export function collectPending(results, { tty = Boolean(process.stdin.isTTY), yes = false } = {}) {
  return results.filter((r) => PENDING.has(r.action) || (r.action === "declined" && !tty && !yes));
}

/** The PENDING USER ACTION block: exact commands for THIS OS, then wait. */
export function renderPendingBlock(pending, { platform = process.platform, retry = "kj install-tools" } = {}) {
  const lines = [
    "════ PENDING USER ACTION ════════════════════════════════════════",
    "kj could not finish this install by itself (sudo or a platform",
    "installer is required). Karajan needs a COMPLETE environment —",
    "do not continue degraded.",
    "",
    "Run in YOUR terminal:",
    "",
  ];
  for (const r of pending) {
    const why = r.error ? `install failed: ${r.error}` : r.reason || "no automatic route on this machine";
    lines.push(`  ▸ ${r.tool}  (${why})`);
    const commands = r.commands
      ?? (r.command ? [r.command] : null)
      ?? (r.suggested ? [r.suggested] : null)
      ?? (osCommandsFor(r.tool, platform).length > 0 ? osCommandsFor(r.tool, platform) : null)
      ?? [`see ${r.manualUrl || "the tool's install docs"}`];
    for (const c of commands) lines.push(`      ${c}`);
    lines.push("");
  }
  lines.push(
    `When done, re-run: ${retry}`,
    "Agents: STOP here, show this block to your user, and WAIT for their",
    `go-ahead. Exit code ${PENDING_EXIT_CODE} means "pending user action" — never proceed past it.`,
  );
  return lines.join("\n");
}
