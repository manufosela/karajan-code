#!/bin/sh
# Karajan Code installer — guarantees a COMPLETE install (KJC-TSK-0658).
#
#   curl -fsSL https://karajancode.com/install.sh | sh
#
# Default route: npm — the full product (CLI + RAG + HU Board + MCP).
#   1. Node >= 22.12 present  → npm install -g karajan-code
#   2. No usable Node         → auto-provision official Node LTS into
#      ~/.karajan/node (checksum-verified, nothing system-wide touched),
#      install karajan-code with it, symlink kj into ~/.local/bin.
# Standalone route (CLI only, no native-module features — RAG/board/MCP
# unavailable): opt-in with `--standalone` or KJ_STANDALONE=1.
#
# POSIX sh only. Env overrides: KJ_VERSION, KJ_INSTALL_DIR.
set -eu

REPO="manufosela/karajan-code"
VERSION="${KJ_VERSION:-latest}"
INSTALL_DIR="${KJ_INSTALL_DIR:-$HOME/.local/bin}"
NODE_MAJOR="22"
NODE_MIN_MINOR="12"
MODE="full"
[ "${1:-}" = "--standalone" ] && MODE="standalone"
[ "${KJ_STANDALONE:-0}" = "1" ] && MODE="standalone"

die() { echo "kj-install: $1" >&2; exit 1; }

# --- Detect OS/arch (shared by both routes). ---
os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) die "unsupported OS '$os'. Supported: Linux, macOS." ;;
esac
case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) die "unsupported architecture '$arch'" ;;
esac

# --- Downloader + checksum tool. ---
if command -v curl >/dev/null 2>&1; then fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then fetch() { wget -qO "$2" "$1"; }
else die "need curl or wget"; fi
if command -v sha256sum >/dev/null 2>&1; then sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die "need sha256sum or shasum to verify downloads"; fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/kj-install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT INT TERM

path_hint() {
  case ":${PATH}:" in
    *":$1:"*) ;;
    *) echo "kj-install: add '$1' to your PATH:  export PATH=\"$1:\$PATH\"  (persist it in ~/.bashrc / ~/.zshrc)" ;;
  esac
}

# --- Is there a usable Node (>= NODE_MAJOR.NODE_MIN_MINOR)? ---
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  v="$(node --version 2>/dev/null | sed 's/^v//')"
  major="${v%%.*}"; rest="${v#*.}"; minor="${rest%%.*}"
  [ "$major" -gt "$NODE_MAJOR" ] 2>/dev/null && return 0
  [ "$major" -eq "$NODE_MAJOR" ] 2>/dev/null && [ "$minor" -ge "$NODE_MIN_MINOR" ] 2>/dev/null
}

npm_pkg() { if [ "$VERSION" = "latest" ]; then echo "karajan-code"; else echo "karajan-code@${VERSION#v}"; fi; }

if [ "$MODE" = "full" ]; then
  if node_ok; then
    echo "kj-install: Node $(node --version) found — installing via npm (full product)..."
    npm install -g "$(npm_pkg)" || die "npm install failed. If it was a permissions error, set a user prefix (npm config set prefix ~/.local) and re-run."
    echo "kj-install: installed $(kj --version 2>/dev/null || echo karajan-code)."
    echo ""
    echo "  Listo. Ahora escribe:  kj go"
    echo ""
    echo "  (avanzado: 'kj doctor' revisa la instalacion, 'kj install-tools' completa el stack)"
    exit 0
  fi

  echo "kj-install: no usable Node (need >= ${NODE_MAJOR}.${NODE_MIN_MINOR}) — provisioning official Node LTS into ~/.karajan/node (nothing system-wide)..."
  dist="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  fetch "${dist}/SHASUMS256.txt" "${tmp}/SHASUMS256.txt" || die "could not fetch the Node checksum list"
  node_asset="$(grep -o "node-v[0-9.]*-${os}-${arch}\.tar\.gz" "${tmp}/SHASUMS256.txt" | head -1)"
  [ -n "$node_asset" ] || die "no official Node build for ${os}-${arch}"
  echo "kj-install: downloading ${node_asset}..."
  fetch "${dist}/${node_asset}" "${tmp}/${node_asset}" || die "could not download Node"
  expected="$(grep "${node_asset}\$" "${tmp}/SHASUMS256.txt" | head -1 | cut -d' ' -f1)"
  actual="$(sha256 "${tmp}/${node_asset}")"
  [ "$expected" = "$actual" ] || die "Node checksum mismatch — aborting, nothing installed"

  # Stage the whole install (extract + npm install) in a sibling dir and only
  # swap it into place once EVERYTHING succeeded — a failed download/extract/
  # install must never destroy a previous working ~/.karajan/node.
  node_home="$HOME/.karajan/node"
  staging="${node_home}.staging.$$"
  rm -rf "$staging"; mkdir -p "$staging"
  trap 'rm -rf "$tmp" "$staging"' EXIT INT TERM
  tar -xzf "${tmp}/${node_asset}" -C "$staging" --strip-components=1 || die "could not extract Node"

  echo "kj-install: installing karajan-code with the provisioned Node..."
  PATH="${staging}/bin:$PATH" "${staging}/bin/npm" install -g "$(npm_pkg)" || die "npm install failed with the provisioned Node"

  # Swap keeping the previous install recoverable at EVERY instant: park it
  # as a backup, arm a trap that restores it on any exit (signal included),
  # move the staged one in, and only then disarm the trap and drop the
  # backup — the user can never end up without a working install.
  backup="${node_home}.old.$$"
  if [ -e "$node_home" ]; then
    mv "$node_home" "$backup" || die "could not park the previous install"
    trap '[ -e "$node_home" ] || mv "$backup" "$node_home" 2>/dev/null; rm -rf "$tmp" "$staging"' EXIT INT TERM
  fi
  mv "$staging" "$node_home" || die "could not move the staged install into place (previous install restored)"
  trap 'rm -rf "$tmp"' EXIT INT TERM
  rm -rf "$backup"
  mkdir -p "$INSTALL_DIR"
  # Wrappers, not symlinks: the shebang (#!/usr/bin/env node) must find the
  # provisioned Node even though it is not on the user's PATH.
  for bin in kj karajan-mcp; do
    [ -e "${node_home}/bin/${bin}" ] || continue
    {
      echo '#!/bin/sh'
      echo "export PATH=\"${node_home}/bin:\$PATH\""
      echo "exec \"${node_home}/bin/${bin}\" \"\$@\""
    } >"${INSTALL_DIR}/${bin}"
    chmod +x "${INSTALL_DIR}/${bin}"
  done
  installed="$("${INSTALL_DIR}/kj" --version 2>/dev/null || echo '?')"
  echo "kj-install: installed kj ${installed} (full product) — kj at ${INSTALL_DIR}/kj"
  path_hint "$INSTALL_DIR"
  echo ""
  echo "  Listo. Ahora escribe:  kj go"
  echo ""
  echo "  (avanzado: 'kj doctor' revisa la instalacion, 'kj install-tools' completa el stack)"
  exit 0
fi

# --- Standalone route: prebuilt single binary (CLI only). ---
echo "kj-install: standalone mode — single binary, NO native-module features (RAG, HU Board and MCP need the npm install)."
target="${os}-${arch}"
case "$target" in
  linux-x64 | darwin-arm64) ;;
  *) die "no prebuilt binary for '$target' (available: linux-x64, darwin-arm64) — run without --standalone for the npm route" ;;
esac
asset="kj-${target}"
if [ "$VERSION" = "latest" ]; then base="https://github.com/${REPO}/releases/latest/download"
else base="https://github.com/${REPO}/releases/download/${VERSION}"; fi

echo "kj-install: downloading ${asset} (${VERSION})..."
fetch "${base}/${asset}" "${tmp}/kj" || die "could not download ${base}/${asset}"
fetch "${base}/${asset}.sha256" "${tmp}/kj.sha256" || die "could not download the checksum for ${asset}"
expected="$(cut -d' ' -f1 <"${tmp}/kj.sha256")"
actual="$(sha256 "${tmp}/kj")"
[ "$expected" = "$actual" ] || die "checksum mismatch — aborting, nothing installed"

chmod +x "${tmp}/kj"
mkdir -p "$INSTALL_DIR"
mv -f "${tmp}/kj" "${INSTALL_DIR}/kj"
if [ "$os" = "darwin" ] && command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "${INSTALL_DIR}/kj" 2>/dev/null || true
fi
installed="$("${INSTALL_DIR}/kj" --version 2>/dev/null || echo '?')"
echo "kj-install: installed standalone kj ${installed} to ${INSTALL_DIR}/kj"
path_hint "$INSTALL_DIR"
echo ""
echo "  Listo. Ahora escribe:  kj go"
echo ""
echo "  (avanzado: 'kj doctor' revisa la instalacion; para el producto completo, re-ejecuta sin --standalone)"
