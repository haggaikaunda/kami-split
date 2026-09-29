#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Compare a temporary generation, without rewriting the working tree.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/apps/api/internal/database"
cp -R apps/api/internal/database/sqlctest "$stage/apps/api/internal/database/"
cp sqlc.yaml "$stage/"
scripts/db-tool.sh sqlc generate -f "$stage/sqlc.yaml"
diff -ru apps/api/internal/database/sqlctest "$stage/apps/api/internal/database/sqlctest"
