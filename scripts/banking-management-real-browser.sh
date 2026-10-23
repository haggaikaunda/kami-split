#!/usr/bin/env bash
# Opt-in browser bridge. The caller owns an already built production preview.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BANKING_MANAGEMENT_BROWSER_ORIGIN:?Supply an exclusively owned production preview}"
: "${BANKING_MANAGEMENT_PLAYWRIGHT_MODULE:?Supply the installed Playwright module}"
: "${BROWSER_AUTH_ORIGIN:?Supply the production preview matching loopback Auth origin}"
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Node24 required")'
root=$PWD
supabase_binary=${SUPABASE_BINARY:-$root/.tools/supabase}
source scripts/tool-versions.env
[[ $("$supabase_binary" --version) == "$SUPABASE_VERSION" ]] || { echo 'Pinned Supabase CLI required' >&2; exit 1; }
stage=$(mktemp -d)
project="kami-management-browser-$(date +%s)-$$"
cleanup() {
  result=$?
  "$supabase_binary" stop --project-id "$project" --no-backup || result=1
  rm -rf "$stage"
  exit "$result"
}
trap cleanup EXIT
mkdir -p "$stage/supabase"
cp supabase/config.toml "$stage/supabase/"
cp -R supabase/migrations supabase/seeds supabase/templates "$stage/supabase/"
python3 - "$stage/supabase/config.toml" "$project" <<'PY'
import socket, sys
path, project = sys.argv[1:]
text = open(path).read().replace('project_id = "kami-split"', f'project_id = "{project}"')
sockets = [socket.socket() for _ in range(4)]
for sock, old in zip(sockets, [55421, 55422, 55420, 55424]):
    sock.bind(('127.0.0.1', 0))
    text = text.replace(str(old), str(sock.getsockname()[1]))
open(path, 'w').write(text)
PY
"$supabase_binary" start --workdir "$stage"
port=$(python3 - "$stage/supabase/config.toml" <<'PY'
import sys, tomllib
with open(sys.argv[1], 'rb') as f: print(tomllib.load(f)['db']['port'])
PY
)
export TEST_DATABASE_URL="postgres://kami_api:kami-local-only@127.0.0.1:$port/postgres?sslmode=disable"
export TEST_WORKER_DATABASE_URL="postgres://kami_worker:kami-worker-local-only@127.0.0.1:$port/postgres?sslmode=disable"
export TEST_DATABASE_ADMIN_URL="postgres://postgres:postgres@127.0.0.1:$port/postgres?sslmode=disable"
cd apps/api
go test -tags=integration -count=1 -timeout=12m -run '^TestBankingManagementRealBrowserJourney$' -v ./internal/graph
