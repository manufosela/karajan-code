#!/bin/sh
# kaRAGan installer — guarantees a COMPLETE install (KJR-TSK-0138).
#
#   curl -fsSL https://rag.karajancode.com/install.sh | sh
#
# npm-first route — the full product (CLI + default LanceDB store):
#   1. Node >= 18 present  → npm install -g karajan-rag @lancedb/lancedb
#   2. No usable Node      → auto-provision official Node LTS into
#      ~/.karajan-rag/node (checksum-verified, nothing system-wide touched),
#      install with it, wrapper for karajan-rag into ~/.local/bin.
# The default store peer (@lancedb/lancedb) is part of a COMPLETE install:
# without it, `karajan-rag index` with defaults cannot run. Package-only
# install (you provide your own store): opt-in with KJR_NO_STORE=1.
#
# POSIX sh only. Env overrides: KJR_VERSION, KJR_INSTALL_DIR, KJR_NO_STORE.
set -eu

VERSION="${KJR_VERSION:-latest}"
INSTALL_DIR="${KJR_INSTALL_DIR:-$HOME/.local/bin}"
NODE_MIN_MAJOR="18"
PROVISION_MAJOR="22"
WITH_STORE="1"
[ "${KJR_NO_STORE:-0}" = "1" ] && WITH_STORE="0"

die() { echo "kjr-install: $1" >&2; exit 1; }

# --- Detect OS/arch. ---
os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) die "unsupported OS '$os'. Supported: Linux, macOS (Windows: irm https://rag.karajancode.com/install.ps1 | iex)." ;;
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

tmp="$(mktemp -d "${TMPDIR:-/tmp}/kjr-install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT INT TERM

path_hint() {
  case ":${PATH}:" in
    *":$1:"*) ;;
    *) echo "kjr-install: add '$1' to your PATH:  export PATH=\"$1:\$PATH\"  (persist it in ~/.bashrc / ~/.zshrc)" ;;
  esac
}

# --- Is there a usable Node (>= NODE_MIN_MAJOR)? ---
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  v="$(node --version 2>/dev/null | sed 's/^v//')"
  major="${v%%.*}"
  [ "$major" -ge "$NODE_MIN_MAJOR" ] 2>/dev/null
}

# Package list: karajan-rag (pinned if KJR_VERSION) + the default store peer.
# Both in ONE npm invocation: if the store peer cannot install, the whole
# install fails — never a silently degraded product.
npm_pkgs() {
  if [ "$VERSION" = "latest" ]; then pkg="karajan-rag"; else pkg="karajan-rag@${VERSION#v}"; fi
  if [ "$WITH_STORE" = "1" ]; then echo "$pkg @lancedb/lancedb"; else echo "$pkg"; fi
}
store_note() {
  if [ "$WITH_STORE" = "0" ]; then
    echo "kjr-install: NOTE — installed WITHOUT the default store (KJR_NO_STORE=1). 'karajan-rag index' with defaults will fail until you provide a store (@lancedb/lancedb or --store pgvector)."
  fi
}

if node_ok; then
  echo "kjr-install: Node $(node --version) found — installing via npm (full product)..."
  # shellcheck disable=SC2086 — npm_pkgs is an intentional word list.
  npm install -g $(npm_pkgs) || die "npm install failed. If it was a permissions error, set a user prefix (npm config set prefix ~/.local) and re-run."
  echo "kjr-install: installed $(karajan-rag --version 2>/dev/null || echo karajan-rag). Run 'karajan-rag doctor' next."
  store_note
  exit 0
fi

echo "kjr-install: no usable Node (need >= ${NODE_MIN_MAJOR}) — provisioning official Node LTS into ~/.karajan-rag/node (nothing system-wide)..."
dist="https://nodejs.org/dist/latest-v${PROVISION_MAJOR}.x"
fetch "${dist}/SHASUMS256.txt" "${tmp}/SHASUMS256.txt" || die "could not fetch the Node checksum list"
node_asset="$(grep -o "node-v[0-9.]*-${os}-${arch}\.tar\.gz" "${tmp}/SHASUMS256.txt" | head -1)"
[ -n "$node_asset" ] || die "no official Node build for ${os}-${arch}"
echo "kjr-install: downloading ${node_asset}..."
fetch "${dist}/${node_asset}" "${tmp}/${node_asset}" || die "could not download Node"
expected="$(grep "${node_asset}\$" "${tmp}/SHASUMS256.txt" | head -1 | cut -d' ' -f1)"
actual="$(sha256 "${tmp}/${node_asset}")"
[ "$expected" = "$actual" ] || die "Node checksum mismatch — aborting, nothing installed"

# Stage the whole install (extract + npm install) in a sibling dir and only
# swap it into place once EVERYTHING succeeded — a failed download/extract/
# install must never destroy a previous working ~/.karajan-rag/node.
node_home="$HOME/.karajan-rag/node"
staging="${node_home}.staging.$$"
rm -rf "$staging"; mkdir -p "$staging"
trap 'rm -rf "$tmp" "$staging"' EXIT INT TERM
tar -xzf "${tmp}/${node_asset}" -C "$staging" --strip-components=1 || die "could not extract Node"

echo "kjr-install: installing karajan-rag with the provisioned Node..."
# shellcheck disable=SC2086 — npm_pkgs is an intentional word list.
PATH="${staging}/bin:$PATH" "${staging}/bin/npm" install -g $(npm_pkgs) || die "npm install failed with the provisioned Node"
[ -e "${staging}/bin/karajan-rag" ] || die "npm reported success but the karajan-rag bin is missing from the staged install — aborting, nothing swapped"

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
# Wrapper, not a symlink: the shebang (#!/usr/bin/env node) must find the
# provisioned Node even though it is not on the user's PATH.
{
  echo '#!/bin/sh'
  echo "export PATH=\"${node_home}/bin:\$PATH\""
  echo "exec \"${node_home}/bin/karajan-rag\" \"\$@\""
} >"${INSTALL_DIR}/karajan-rag"
chmod +x "${INSTALL_DIR}/karajan-rag"
installed="$("${INSTALL_DIR}/karajan-rag" --version 2>/dev/null || echo '?')"
echo "kjr-install: installed karajan-rag ${installed} (full product) — bin at ${INSTALL_DIR}/karajan-rag"
path_hint "$INSTALL_DIR"
store_note
echo "kjr-install: next — run 'karajan-rag doctor', then point it at a corpus: 'karajan-rag init .'"
