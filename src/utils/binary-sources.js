// Standalone install routes for tools with no package manager available
// (KJC-TSK-0607). On a machine with no pipx/brew/go, `kj install-tools`
// still needs a way to install osv-scanner and semgrep.
//
//  · osv-scanner ships a single static binary per platform on its GitHub
//    releases — we build the /latest/download URL for the current platform.
//  · semgrep has no single static binary; we offer the most viable concrete
//    command (Docker image if docker exists, otherwise bootstrapping pipx).

const OSV_BASE = "https://github.com/google/osv-scanner/releases/latest/download";

function osvOs(platform) {
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "windows";
  return null;
}

function osvArch(arch) {
  if (arch === "x64") return "amd64";
  if (arch === "arm64") return "arm64";
  return null;
}

/**
 * Build the osv-scanner static-binary download source for a platform+arch,
 * or null when the combination has no published asset.
 *
 * @returns {{ url: string, name: string }|null}
 */
export function osvScannerSource(platform = process.platform, arch = process.arch) {
  const os = osvOs(platform);
  const a = osvArch(arch);
  if (!os || !a) return null;
  const ext = os === "windows" ? ".exe" : "";
  return { url: `${OSV_BASE}/osv-scanner_${os}_${a}${ext}`, name: `osv-scanner${ext}` };
}

/**
 * Most viable concrete route to install semgrep without a package manager.
 * Returns a command the user sees before it runs — never a bare docs URL.
 *
 * @returns {{ via: "docker"|"pipx", command: string }}
 */
export function semgrepFallback(available = {}) {
  if (available.docker) return { via: "docker", command: "docker pull semgrep/semgrep" };
  return { via: "pipx", command: "python3 -m pip install --user pipx && pipx install semgrep" };
}

/**
 * Resolve the standalone route for a tool when no package manager matched.
 *  · binary  → download a static binary into ~/.local/bin.
 *  · command → run/show a concrete install command.
 *
 * @returns {{ kind: "binary", url: string, name: string }|{ kind: "command", via: string, command: string }|null}
 */
export function resolveStandalone(tool, available = {}, platform = process.platform, arch = process.arch) {
  if (tool === "osv-scanner") {
    const src = osvScannerSource(platform, arch);
    return src ? { kind: "binary", ...src } : null;
  }
  if (tool === "semgrep") return { kind: "command", ...semgrepFallback(available) };
  return null;
}
