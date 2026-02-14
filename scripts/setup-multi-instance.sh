#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT_DIR/scripts/install.sh"

if [[ ! -x "$INSTALLER" ]]; then
  echo "Installer not found: $INSTALLER"
  exit 1
fi

echo "Karajan multi-instance setup (personal + pro)"
echo

read -r -p "Sonar host [http://localhost:9000]: " SONAR_HOST
SONAR_HOST="${SONAR_HOST:-http://localhost:9000}"

read -r -p "Personal KJ_HOME [$HOME/.karajan-personal]: " PERSONAL_HOME
PERSONAL_HOME="${PERSONAL_HOME:-$HOME/.karajan-personal}"

read -r -p "Pro KJ_HOME [$HOME/.karajan-pro]: " PRO_HOME
PRO_HOME="${PRO_HOME:-$HOME/.karajan-pro}"

echo
read -r -p "Personal Sonar token (KJ_SONAR_TOKEN): " PERSONAL_TOKEN
read -r -p "Pro Sonar token (KJ_SONAR_TOKEN): " PRO_TOKEN

read -r -p "Coder default [codex]: " CODER
CODER="${CODER:-codex}"

read -r -p "Reviewer default [claude]: " REVIEWER
REVIEWER="${REVIEWER:-claude}"

read -r -p "Reviewer fallback [codex]: " REVIEWER_FALLBACK
REVIEWER_FALLBACK="${REVIEWER_FALLBACK:-codex}"

echo
echo "Setting up PERSONAL instance..."
"$INSTALLER" \
  --non-interactive \
  --link-global false \
  --kj-home "$PERSONAL_HOME" \
  --sonar-host "$SONAR_HOST" \
  --sonar-token "$PERSONAL_TOKEN" \
  --coder "$CODER" \
  --reviewer "$REVIEWER" \
  --reviewer-fallback "$REVIEWER_FALLBACK" \
  --setup-mcp-claude false \
  --setup-mcp-codex false \
  --run-doctor true

echo
echo "Setting up PRO instance..."
"$INSTALLER" \
  --non-interactive \
  --link-global false \
  --kj-home "$PRO_HOME" \
  --sonar-host "$SONAR_HOST" \
  --sonar-token "$PRO_TOKEN" \
  --coder "$CODER" \
  --reviewer "$REVIEWER" \
  --reviewer-fallback "$REVIEWER_FALLBACK" \
  --setup-mcp-claude false \
  --setup-mcp-codex false \
  --run-doctor true

CLAUDE_SETTINGS="$HOME/.claude/settings.json"
CODEX_CONFIG="$HOME/.codex/config.toml"
SERVER_PATH="$ROOT_DIR/src/mcp/server.js"

mkdir -p "$HOME/.claude" "$HOME/.codex"

if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
  cat > "$CLAUDE_SETTINGS" <<JSON
{
  "mcpServers": {}
}
JSON
fi

node - <<NODE
const fs = require('fs');
const p = "$CLAUDE_SETTINGS";
const serverPath = "$SERVER_PATH";
const rootDir = "$ROOT_DIR";
const personalHome = "$PERSONAL_HOME";
const proHome = "$PRO_HOME";
const personalToken = "$PERSONAL_TOKEN";
const proToken = "$PRO_TOKEN";
let settings = {};
try { settings = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { settings = {}; }
settings.mcpServers = settings.mcpServers || {};
settings.mcpServers['karajan-personal'] = {
  command: 'node',
  args: [serverPath],
  cwd: rootDir,
  env: { KJ_HOME: personalHome, KJ_SONAR_TOKEN: personalToken }
};
settings.mcpServers['karajan-pro'] = {
  command: 'node',
  args: [serverPath],
  cwd: rootDir,
  env: { KJ_HOME: proHome, KJ_SONAR_TOKEN: proToken }
};
fs.writeFileSync(p, JSON.stringify(settings, null, 2) + '\\n');
NODE

if [[ ! -f "$CODEX_CONFIG" ]]; then
  touch "$CODEX_CONFIG"
fi

TMP_CODEX="$(mktemp)"
cp "$CODEX_CONFIG" "$TMP_CODEX"

sed -i '/# BEGIN karajan-multi/,/# END karajan-multi/d' "$TMP_CODEX"
cat >> "$TMP_CODEX" <<TOML

# BEGIN karajan-multi
[mcp_servers."karajan-personal"]
command = "node"
args = ["$SERVER_PATH"]
cwd = "$ROOT_DIR"

[mcp_servers."karajan-personal".env]
KJ_HOME = "$PERSONAL_HOME"
KJ_SONAR_TOKEN = "$PERSONAL_TOKEN"

[mcp_servers."karajan-pro"]
command = "node"
args = ["$SERVER_PATH"]
cwd = "$ROOT_DIR"

[mcp_servers."karajan-pro".env]
KJ_HOME = "$PRO_HOME"
KJ_SONAR_TOKEN = "$PRO_TOKEN"
# END karajan-multi
TOML

mv "$TMP_CODEX" "$CODEX_CONFIG"

echo
echo "Multi-instance setup completed."
echo "- Personal KJ_HOME: $PERSONAL_HOME"
echo "- Pro KJ_HOME: $PRO_HOME"
echo "- Claude MCP updated: $CLAUDE_SETTINGS"
echo "- Codex MCP updated: $CODEX_CONFIG"
echo
echo "Next steps:"
echo "1) Restart Claude and Codex."
echo "2) In each client, use MCP server karajan-personal or karajan-pro."
