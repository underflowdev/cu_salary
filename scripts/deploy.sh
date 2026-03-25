#!/usr/bin/env bash
# Deploy to S3. Configure scripts/deploy.env (see deploy.env.example).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_FILE="$SCRIPT_DIR/deploy.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Copy deploy.env.example and fill in your values." >&2
  exit 1
fi
# shellcheck source=deploy.env.example
source "$ENV_FILE"

PREFIX="cu"

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

echo "Invalidating CloudFront distribution..."
aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*"

echo "Done. Site live at https://$BUCKET/$PREFIX"
