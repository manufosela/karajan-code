#!/bin/bash
# Run E2E smoke tests in a clean Docker container.
# Usage: ./tests/e2e/run-e2e.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Packing karajan-code..."
cd "$PROJECT_DIR"
npm pack --pack-destination "$SCRIPT_DIR" > /dev/null 2>&1
TARBALL=$(ls "$SCRIPT_DIR"/karajan-code-*.tgz 2>/dev/null | head -1)
if [ -z "$TARBALL" ]; then
  echo "ERROR: npm pack failed"
  exit 1
fi
mv "$TARBALL" "$SCRIPT_DIR/karajan-code.tgz"

echo "Building Docker image..."
docker buildx build -t kj-e2e-test "$SCRIPT_DIR" 2>/dev/null || docker build -t kj-e2e-test "$SCRIPT_DIR"

echo "Running E2E tests..."
docker run --rm kj-e2e-test

# Cleanup
rm -f "$SCRIPT_DIR/karajan-code.tgz"
echo "Done."
