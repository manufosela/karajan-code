import os from "node:os";

/**
 * Detect platform and return OS-appropriate install commands.
 */
export function getPlatform() {
  const platform = os.platform();
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

const INSTALL_COMMANDS = {
  rtk: {
    macos: "brew install rtk && rtk init --global",
    linux: "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh && rtk init --global",
    windows: "Download from https://github.com/rtk-ai/rtk/releases and add to PATH"
  },
  squeezr: {
    macos: "npm install -g squeezr-ai",
    linux: "npm install -g squeezr-ai",
    windows: "npm install -g squeezr-ai"
  },
  qmd: {
    macos: "npm install -g @tobilu/qmd",
    linux: "npm install -g @tobilu/qmd",
    windows: "npm install -g @tobilu/qmd"
  },
  claude: {
    macos: "npm install -g @anthropic-ai/claude-code",
    linux: "npm install -g @anthropic-ai/claude-code",
    windows: "npm install -g @anthropic-ai/claude-code"
  },
  codex: {
    macos: "npm install -g @openai/codex",
    linux: "npm install -g @openai/codex",
    windows: "npm install -g @openai/codex"
  },
  gemini: {
    macos: "npm install -g @google/gemini-cli",
    linux: "npm install -g @google/gemini-cli",
    windows: "npm install -g @google/gemini-cli"
  },
  aider: {
    macos: "pipx install aider-chat",
    linux: "pipx install aider-chat || pip3 install aider-chat",
    windows: "pip install aider-chat"
  },
  opencode: {
    macos: "curl -fsSL https://opencode.ai/install | bash",
    linux: "curl -fsSL https://opencode.ai/install | bash",
    windows: "See https://github.com/nicepkg/opencode for Windows install"
  },
  qwen: {
    macos: "npm install -g @qwen-code/qwen-code",
    linux: "npm install -g @qwen-code/qwen-code",
    windows: "npm install -g @qwen-code/qwen-code"
  },
  agy: {
    macos: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    linux: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    windows: "irm https://antigravity.google/cli/install.ps1 | iex"
  },
  copilot: {
    macos: "npm install -g @github/copilot",
    linux: "npm install -g @github/copilot",
    windows: "npm install -g @github/copilot"
  },
  docker: {
    macos: "brew install --cask docker",
    linux: "sudo apt install docker.io docker-compose-v2 (or see https://docs.docker.com/engine/install/)",
    windows: "Download Docker Desktop from https://www.docker.com/products/docker-desktop/"
  }
};

export function getInstallCommand(tool) {
  const platform = getPlatform();
  return INSTALL_COMMANDS[tool]?.[platform] || INSTALL_COMMANDS[tool]?.linux || `Install ${tool} manually`;
}
