#!/bin/bash
set -e

PASS=0
FAIL=0
TOTAL=0

check() {
  local name="$1"
  shift
  TOTAL=$((TOTAL + 1))
  if "$@" > /dev/null 2>&1; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "=== Karajan Code E2E Smoke Tests ==="
echo ""

# 1. CLI is installed and responds
check "kj --version" kj --version
check "kj-tail --help" kj-tail --help
check "karajan-mcp exists" which karajan-mcp

# 2. kj doctor runs (will report missing agents, but should not crash)
check "kj doctor runs" kj doctor

# 3. kj init --no-interactive creates config
check "kj init --no-interactive" kj init --no-interactive

# 4. Config file was created
check "kj.config.yml exists" test -f ~/.karajan/kj.config.yml

# 5. kj config shows output
check "kj config" kj config

# 6. kj roles list works
check "kj roles list" kj roles list

# 7. kj roles show coder works
check "kj roles show coder" kj roles show coder

# 8. Templates exist
check "coder.md template" test -f "$(npm root -g)/karajan-code/templates/roles/coder.md"
check "reviewer.md template" test -f "$(npm root -g)/karajan-code/templates/roles/reviewer.md"
check "solomon.md template" test -f "$(npm root -g)/karajan-code/templates/roles/solomon.md"

# 9. MCP server starts and responds (quick check, kill after 2s)
check "karajan-mcp starts" timeout 3 karajan-mcp || test $? -eq 124

# 10. kj audit runs (standalone command)
check "kj audit --help" kj audit --help

echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
