#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/tool-versions.env
case "${1:-}" in
 supabase) tool=supabase; expected=$SUPABASE_VERSION; actual=$(.tools/supabase --version);;
 sqlc) tool=sqlc; expected="v$SQLC_VERSION"; actual=$(.tools/sqlc version);;
 *) echo 'Usage: db-tool.sh supabase|sqlc [arguments]' >&2; exit 1;;
esac
[[ "$actual" == "$expected" ]] || { echo "Wrong $tool version; run make db-tools" >&2; exit 1; }
shift
exec ".tools/$tool" "$@"
