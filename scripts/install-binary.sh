#!/bin/sh
# Karajan Code — standalone binary installer (no Node required).
#
#   curl -fsSL https://karajancode.com/install.sh | sh
#
# Downloads the prebuilt `kj` binary for your OS/arch from the GitHub
# release, verifies its SHA256 checksum, and installs it to ~/.local/bin.
# Override with env vars: KJ_VERSION (e.g. v3.7.2), KJ_INSTALL_DIR.
#
# POSIX sh only — no bashisms, no Node. KJC-TSK-0593.
set -eu

REPO="manufosela/karajan-code"
VERSION="${KJ_VERSION:-latest}"
INSTALL_DIR="${KJ_INSTALL_DIR:-$HOME/.local/bin}"

die() {
  echo "kj-install: $1" >&2
  exit 1
}

# --- Detect OS/arch, map to the release asset names we actually build. ---
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) die "unsupported OS '$os'. Supported: Linux, macOS. Use npm instead: npm install -g karajan-code" ;;
esac
case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) die "unsupported architecture '$arch'" ;;
esac

target="${os}-${arch}"
case "$target" in
  linux-x64) ;;
  darwin-arm64)
    # The macOS standalone binary is not published yet (tracked in
    # KJC-BUG-0096: the darwin-arm64 SEA build crashes under smoke-test).
    # Degrade gracefully to the npm install path instead of trying to
    # download an asset that does not exist.
    echo "kj-install: the macOS standalone binary is not available yet." >&2
    echo "kj-install: install with npm instead (requires Node 18+):" >&2
    echo "  npm install -g karajan-code" >&2
    exit 0
    ;;
  *) die "no prebuilt binary for '$target'. Available: linux-x64. On macOS use npm instead: npm install -g karajan-code" ;;
esac

# --- Resolve the download URL for the requested version (or latest). ---
asset="kj-${target}"
if [ "$VERSION" = "latest" ]; then
  base="https://github.com/${REPO}/releases/latest/download"
else
  base="https://github.com/${REPO}/releases/download/${VERSION}"
fi

# --- Pick a downloader. ---
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  die "need curl or wget to download the binary"
fi

# --- Pick a checksum tool. ---
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die "need sha256sum or shasum to verify the download"
fi

# --- Download to a temp dir; only install after the checksum matches. ---
tmp="$(mktemp -d "${TMPDIR:-/tmp}/kj-install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "kj-install: downloading ${asset} (${VERSION})..."
fetch "${base}/${asset}" "${tmp}/kj" || die "could not download ${base}/${asset} — does that version/asset exist?"
fetch "${base}/${asset}.sha256" "${tmp}/kj.sha256" || die "could not download the checksum for ${asset}"

expected="$(cut -d' ' -f1 <"${tmp}/kj.sha256")"
actual="$(sha256 "${tmp}/kj")"
[ "$expected" = "$actual" ] || die "checksum mismatch (expected ${expected}, got ${actual}). Aborting, nothing installed."

# --- Install atomically: chmod on the temp file, then move into place. ---
chmod +x "${tmp}/kj"
mkdir -p "$INSTALL_DIR"
mv -f "${tmp}/kj" "${INSTALL_DIR}/kj"

# On macOS the binary is ad-hoc signed, not notarized with a paid Apple
# certificate, so Gatekeeper can quarantine it. Clear the flag on the copy
# we just checksummed ourselves (no-op on Linux / if the flag is absent).
if [ "$os" = "darwin" ] && command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "${INSTALL_DIR}/kj" 2>/dev/null || true
fi

installed="$("${INSTALL_DIR}/kj" --version 2>/dev/null || echo '?')"
echo "kj-install: installed kj ${installed} to ${INSTALL_DIR}/kj"

# --- Tell the user how to reach it if the dir is not on PATH. ---
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) echo "kj-install: '${INSTALL_DIR}' is on your PATH — run 'kj --help' to get started." ;;
  *)
    echo "kj-install: '${INSTALL_DIR}' is not on your PATH. Add it with:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo "  (add that line to ~/.bashrc, ~/.zshrc or ~/.profile to make it permanent)"
    ;;
esac

# --- Prerequisites: the binary bundles no toolchain. kj orchestrates ---
# --- external tools, so name the hard requirements and let `kj doctor` ---
# --- check them precisely for this machine.
echo ""
echo "kj-install: next step — run 'kj doctor' to check prerequisites."
echo "  Required: git, plus at least one agent CLI (Claude Code, Codex or Gemini)."
echo "  Optional: Docker (local models, SonarQube) and Node/npm (helper tools: Squeezr, qmd)."
