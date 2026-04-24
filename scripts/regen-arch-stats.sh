#!/usr/bin/env bash
# Regenerate the numeric stats in docs/ARCHITECTURE.md from the current tree.
#
# Motivation: docs/ARCHITECTURE.md accumulates staleness. The v2.7.4 audit
# found it claimed "28k LOC, 234 files" when reality was 35.9k LOC / 260
# files (+28% LOC, +11% files), and pointed at `src/orchestrator.js` as the
# main pipeline (~1400 LOC) when the real orchestrator is
# `src/orchestrator/flow-runner.js` (2241 LOC) and `src/orchestrator.js` is
# a 22-line barrel.
#
# This script rewrites the specific lines that contain numeric stats
# in-place; narrative paragraphs are left alone.
#
# Usage:
#   scripts/regen-arch-stats.sh          # rewrite and exit 0
#   scripts/regen-arch-stats.sh --check  # exit 1 if the file would change
#
# Add to the release checklist: run without --check, commit any diff.
set -euo pipefail

MODE="${1:-}"
DOC="docs/ARCHITECTURE.md"

if [[ ! -f "$DOC" ]]; then
  echo "ARCHITECTURE.md not found at $DOC — run from the repo root." >&2
  exit 2
fi

# ── Compute current stats ──────────────────────────────────────────────

SRC_LOC=$(find src -name "*.js" -not -path "*/node_modules/*" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
SRC_FILES=$(find src -name "*.js" -not -path "*/node_modules/*" | wc -l)
TEST_COUNT=$(find tests -name "*.test.js" -not -path "*/worktrees/*" -not -path "*/.kj/*" | wc -l)

# Format LOC with thousands separator ("36038" → "36k" for narrative, raw for table)
SRC_LOC_SHORT=$(awk -v n="$SRC_LOC" 'BEGIN{ printf "%dk", int(n/1000) }')

# Orchestrator pipeline stats
FLOW_RUNNER_LOC=$(wc -l < src/orchestrator/flow-runner.js 2>/dev/null | awk '{print $1}')
BARREL_LOC=$(wc -l < src/orchestrator.js 2>/dev/null | awk '{print $1}')

# ── Build a sed program ────────────────────────────────────────────────
# Each line targets a specific claim. Patterns are narrow enough to miss
# unrelated mentions but wide enough to absorb small formatting drifts.

SED_SCRIPT=$(cat <<EOF
s|Source code ([0-9kKmM.]\\+ LOC, [0-9]\\+ files)|Source code (${SRC_LOC_SHORT} LOC, ${SRC_FILES} files)|g
s|Test suite ([0-9]\\+ tests)|Test suite (${TEST_COUNT} test files)|g
s|\`src/orchestrator.js\` (~[0-9]\\+ LOC)|\`src/orchestrator.js\` (${BARREL_LOC}-line barrel) → delegates to \`src/orchestrator/flow-runner.js\` (${FLOW_RUNNER_LOC} LOC)|g
EOF
)

if [[ "$MODE" == "--check" ]]; then
  if sed "$SED_SCRIPT" "$DOC" | diff -q "$DOC" - >/dev/null; then
    echo "docs/ARCHITECTURE.md stats are up to date."
    exit 0
  fi
  echo "docs/ARCHITECTURE.md stats are STALE. Run scripts/regen-arch-stats.sh to rewrite." >&2
  sed "$SED_SCRIPT" "$DOC" | diff -u "$DOC" - || true
  exit 1
fi

# Real rewrite, in place, with backup we immediately delete to keep the
# working tree clean.
sed -i.bak "$SED_SCRIPT" "$DOC"
rm -f "${DOC}.bak"

echo "docs/ARCHITECTURE.md updated with:"
echo "  Source code: ${SRC_LOC_SHORT} LOC, ${SRC_FILES} files"
echo "  Tests:       ${TEST_COUNT} test files"
echo "  Orchestrator: src/orchestrator.js ${BARREL_LOC}-line barrel → flow-runner.js ${FLOW_RUNNER_LOC} LOC"
