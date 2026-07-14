// How `kj install-tools` installs Docker, resolved per platform (KJC-TSK-0609,
// absorbing the sudo+apt/dnf primitive of KJC-TSK-0608).
//
//  · Linux: prefer the distro package manager (apt → docker.io, dnf → docker)
//    run through `sudo` on the user's own tty — kj never sees the password.
//    When neither is present, fall back to Docker's official convenience
//    script, which the caller downloads to a file and runs (never `curl | sh`).
//  · macOS / Windows: never auto-install (platform-specific, invasive) — point
//    at the official docs, suggesting the brew cask on macOS.

const GET_DOCKER_URL = "https://get.docker.com";
const DOCKER_DOCS_URL = "https://docs.docker.com/get-docker/";

/**
 * Resolve the Docker install plan for a platform + available managers.
 *
 * @param {string} platform - process.platform value (linux/darwin/win32).
 * @param {Record<string, boolean>} available - detected package managers.
 * @returns {{ kind: "package", manager: string, command: string }
 *          | { kind: "script", url: string }
 *          | { kind: "manual", manualUrl: string, suggested: string|null }}
 */
export function dockerInstallPlan(platform = process.platform, available = {}) {
  if (platform !== "linux") {
    return {
      kind: "manual",
      manualUrl: DOCKER_DOCS_URL,
      suggested: available.brew ? "brew install --cask docker" : null,
    };
  }
  if (available.apt) return { kind: "package", manager: "apt", command: "sudo apt-get install -y docker.io" };
  if (available.dnf) return { kind: "package", manager: "dnf", command: "sudo dnf install -y docker" };
  return { kind: "script", url: GET_DOCKER_URL };
}
