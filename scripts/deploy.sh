#!/usr/bin/env bash
# Deploy to S3 at underflow.dev/cu

set -euo pipefail

BUCKET="underflow.dev"
PREFIX="cu"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Syncing site → s3://$BUCKET/$PREFIX/"
aws s3 sync "$REPO_ROOT/site/" "s3://$BUCKET/$PREFIX/" \
  --delete \
  --exclude "*.py" \
  --cache-control "max-age=300"

echo "Syncing data → s3://$BUCKET/$PREFIX/data/"
aws s3 sync "$REPO_ROOT/data/" "s3://$BUCKET/$PREFIX/data/" \
  --delete \
  --exclude "progress.json" \
  --cache-control "max-age=3600"

echo "Done. Site live at https://underflow.dev/cu"
