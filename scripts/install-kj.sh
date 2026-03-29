#!/bin/sh
# Karajan Code - Universal Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/manufosela/karajan-code/main/scripts/install-kj.sh | sh
#
# Installs karajan-code globally via npm if Node.js >= 18 is available.
# If Node.js is not installed, prints platform-specific instructions.

# --- Color support ---
setup_colors() {
  if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
    BOLD="$(tput bold)"
    GREEN="$(tput setaf 2)"
    YELLOW="$(tput setaf 3)"
    RED="$(tput setaf 1)"
    CYAN="$(tput setaf 6)"
    RESET="$(tput sgr0)"
  else
    BOLD="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
  fi
}

info()    { printf '%s[info]%s  %s\n' "$CYAN" "$RESET" "$1"; }
success() { printf '%s[ok]%s    %s\n' "$GREEN" "$RESET" "$1"; }
warn()    { printf '%s[warn]%s  %s\n' "$YELLOW" "$RESET" "$1"; }
error()   { printf '%s[error]%s %s\n' "$RED" "$RESET" "$1"; }

# --- Platform detection ---
detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Linux*)  PLATFORM="linux" ;;
    Darwin*) PLATFORM="macos" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *)       PLATFORM="unknown" ;;
  esac

  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)             ARCH="$ARCH" ;;
  esac
}

# --- Check Node.js ---
check_node() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi

  NODE_VERSION="$(node --version 2>/dev/null | sed 's/^v//')"
  NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d. -f1)"

  if [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
    warn "Node.js v${NODE_VERSION} found, but v18+ is required."
    return 1
  fi

  return 0
}

# --- Print Node.js install instructions ---
print_node_instructions() {
  echo ""
  error "Node.js >= 18 is required but not found."
  echo ""
  printf '%sInstall Node.js for your platform:%s\n' "$BOLD" "$RESET"
  echo ""

  case "$PLATFORM" in
    linux)
      echo "  Option 1 - nvm (recommended):"
      echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
      echo "    nvm install 22"
      echo ""
      echo "  Option 2 - NodeSource:"
      echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
      echo "    sudo apt-get install -y nodejs"
      ;;
    macos)
      echo "  Option 1 - nvm (recommended):"
      echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
      echo "    nvm install 22"
      echo ""
      echo "  Option 2 - Homebrew:"
      echo "    brew install node@22"
      ;;
    windows)
      echo "  Option 1 - nvm-windows:"
      echo "    https://github.com/coreybutler/nvm-windows/releases"
      echo ""
      echo "  Option 2 - Download installer:"
      echo "    https://nodejs.org/en/download/"
      ;;
    *)
      echo "  Download from: https://nodejs.org/en/download/"
      ;;
  esac

  echo ""
  echo "  After installing Node.js, re-run this script:"
  echo "    curl -fsSL https://raw.githubusercontent.com/manufosela/karajan-code/main/scripts/install-kj.sh | sh"
  echo ""
}

# --- Install via npm ---
install_karajan() {
  info "Installing karajan-code via npm..."
  echo ""

  if npm install -g karajan-code; then
    success "karajan-code installed successfully."
  else
    echo ""
    error "npm install failed."
    echo ""
    echo "  Common fixes:"
    echo "    - Permission error? Use: sudo npm install -g karajan-code"
    echo "    - Or configure npm prefix: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally"
    echo ""
    exit 1
  fi
}

# --- Verify installation ---
verify_install() {
  echo ""
  if command -v kj >/dev/null 2>&1; then
    KJ_VERSION="$(kj --version 2>/dev/null || echo "unknown")"
    success "kj ${KJ_VERSION} is ready."
  else
    warn "kj command not found in PATH. You may need to restart your shell."
    return 1
  fi
}

# --- Run kj init ---
run_init() {
  if command -v kj >/dev/null 2>&1; then
    info "Running kj init to detect installed agents..."
    echo ""
    kj init --no-interactive 2>/dev/null || true
    echo ""
  fi
}

# --- Print next steps ---
print_next_steps() {
  echo ""
  printf '%s%s--- Karajan Code installed ---%s\n' "$BOLD" "$GREEN" "$RESET"
  echo ""
  echo "  Next steps:"
  echo ""
  echo "    1. Go to a project directory:"
  echo "       cd your-project/"
  echo ""
  echo "    2. Run from CLI:"
  echo "       kj run \"Add input validation with tests\""
  echo ""
  echo "    3. Or use as MCP server inside Claude Code / Codex:"
  echo "       The MCP server auto-registers during install."
  echo "       Open kj-tail in a separate terminal to see pipeline output."
  echo ""
  echo "  Docs: https://karajancode.com"
  echo ""
}

# --- Main ---
main() {
  setup_colors

  echo ""
  printf '%s%sKarajan Code Installer%s\n' "$BOLD" "$CYAN" "$RESET"
  echo ""

  detect_platform
  info "Detected: ${PLATFORM} (${ARCH})"

  if ! check_node; then
    print_node_instructions
    exit 1
  fi

  success "Node.js v${NODE_VERSION} detected."

  install_karajan
  verify_install
  run_init
  print_next_steps
}

main
