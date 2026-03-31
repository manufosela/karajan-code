#!/bin/bash
#
# Configures branch protection on all repos of a GitHub user.
# Requires: gh CLI authenticated with admin permissions.
#
# Usage:
#   ./scripts/protect-all-repos.sh              # dry-run (shows what it would do)
#   ./scripts/protect-all-repos.sh --apply      # apply protection rules
#
# What it does:
#   - Require PRs before merging (no direct push to default branch)
#   - Block force push
#   - Block branch deletion
#
# Skips repos where branch protection is already configured.

set -euo pipefail

OWNER="${GH_OWNER:-manufosela}"
APPLY=false

if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

echo "=== Branch Protection for all repos of $OWNER ==="
echo ""

if [[ "$APPLY" == false ]]; then
  echo "  DRY RUN mode. Use --apply to actually configure."
  echo ""
fi

REPOS=$(gh repo list "$OWNER" --limit 500 --json name,defaultBranchRef,isArchived \
  --jq '.[] | select(.isArchived == false) | "\(.name)\t\(.defaultBranchRef.name // "main")"')

TOTAL=0
PROTECTED=0
SKIPPED=0
FAILED=0

while IFS=$'\t' read -r REPO BRANCH; do
  TOTAL=$((TOTAL + 1))

  # Check if already protected
  STATUS=$(gh api "repos/$OWNER/$REPO/branches/$BRANCH/protection" --jq '.required_pull_request_reviews.required_approving_review_count // 0' 2>/dev/null || echo "none")

  if [[ "$STATUS" != "none" ]]; then
    echo "  SKIP  $REPO ($BRANCH) — already protected"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [[ "$APPLY" == false ]]; then
    echo "  WOULD $REPO ($BRANCH)"
    continue
  fi

  # Apply protection
  if gh api "repos/$OWNER/$REPO/branches/$BRANCH/protection" -X PUT \
    --input - <<EOF 2>/dev/null; then
{
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false
  },
  "enforce_admins": false,
  "required_status_checks": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
    echo "  OK    $REPO ($BRANCH)"
    PROTECTED=$((PROTECTED + 1))
  else
    echo "  FAIL  $REPO ($BRANCH) — check permissions"
    FAILED=$((FAILED + 1))
  fi

done <<< "$REPOS"

echo ""
echo "=== Summary ==="
echo "  Total:     $TOTAL"
echo "  Protected: $PROTECTED"
echo "  Skipped:   $SKIPPED"
echo "  Failed:    $FAILED"
