#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Compare a temporary generation, without rewriting the working tree.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/apps/api/internal/database"
cp -R apps/api/internal/database/sqlctest apps/api/internal/database/identityquery apps/api/internal/database/expensequery "$stage/apps/api/internal/database/"
mkdir -p "$stage/supabase"
cp -R supabase/schemas "$stage/supabase/"
cp sqlc.yaml "$stage/"
scripts/db-tool.sh sqlc generate -f "$stage/sqlc.yaml"
diff -ru apps/api/internal/database/sqlctest "$stage/apps/api/internal/database/sqlctest"
diff -ru apps/api/internal/database/identityquery "$stage/apps/api/internal/database/identityquery"

diff -ru apps/api/internal/database/expensequery "$stage/apps/api/internal/database/expensequery"
