#!/bin/bash
#
# Installs the AI Attribution Guard workflow in all repos of a GitHub user.
# Requires: gh CLI authenticated with admin/push permissions.
#
# Usage:
#   ./scripts/install-guard-all-repos.sh              # dry-run
#   ./scripts/install-guard-all-repos.sh --apply       # install in all repos
#
# What it does:
#   - Creates .github/workflows/ai-attribution-guard.yml in each repo
#   - Skips repos that already have the file
#   - Skips archived repos

set -euo pipefail

OWNER="${GH_OWNER:-manufosela}"
APPLY=false
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_FILE="$SCRIPT_DIR/ai-attribution-guard.yml"

if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

if [[ ! -f "$WORKFLOW_FILE" ]]; then
  echo "ERROR: $WORKFLOW_FILE not found"
  exit 1
fi

CONTENT=$(base64 -w 0 "$WORKFLOW_FILE")

echo "=== Install AI Attribution Guard in all repos of $OWNER ==="
echo ""

if [[ "$APPLY" == false ]]; then
  echo "  DRY RUN mode. Use --apply to actually install."
  echo ""
fi

REPOS=$(gh repo list "$OWNER" --limit 500 --json name,isArchived \
  --jq '.[] | select(.isArchived == false) | .name')

TOTAL=0
INSTALLED=0
SKIPPED=0
FAILED=0

while read -r REPO; do
  [ -z "$REPO" ] && continue
  TOTAL=$((TOTAL + 1))

  # Check if workflow already exists
  EXISTS=$(gh api "repos/$OWNER/$REPO/contents/.github/workflows/ai-attribution-guard.yml" --jq '.sha' 2>/dev/null || echo "")

  if [[ -n "$EXISTS" ]]; then
    echo "  SKIP  $REPO — workflow already exists"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [[ "$APPLY" == false ]]; then
    echo "  WOULD $REPO"
    continue
  fi

  if gh api "repos/$OWNER/$REPO/contents/.github/workflows/ai-attribution-guard.yml" -X PUT \
    -f message="chore: add AI attribution guard workflow" \
    -f content="$CONTENT" \
    --jq '.commit.sha' 2>/dev/null; then
    echo "  OK    $REPO"
    INSTALLED=$((INSTALLED + 1))
  else
    echo "  FAIL  $REPO — check permissions"
    FAILED=$((FAILED + 1))
  fi

done <<< "$REPOS"

echo ""
echo "=== Summary ==="
echo "  Total:     $TOTAL"
echo "  Installed: $INSTALLED"
echo "  Skipped:   $SKIPPED"
echo "  Failed:    $FAILED"
