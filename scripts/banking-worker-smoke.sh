#!/usr/bin/env bash
# Starts the actual binary against a caller-owned disposable, empty banking DB.
# The caller owns migrations, restricted-role credentials and database cleanup.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BANKING_WORKER_SMOKE_DATABASE_URL:?supply the disposable kami_worker database URL}"
stage=$(mktemp -d)
worker_pid=
cleanup() {
  result=$?
  if [[ -n "$worker_pid" ]]; then
    kill -TERM "$worker_pid" 2>/dev/null || true
    for ((cleanup_attempt=0; cleanup_attempt<30; cleanup_attempt++)); do
      if ! kill -0 "$worker_pid" 2>/dev/null; then break; fi
      sleep 0.1
    done
    kill -KILL "$worker_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
  fi
  if [[ "$result" == 0 ]]; then
    rm -rf "$stage"
  else
    echo "Worker smoke diagnostics retained in $stage" >&2
  fi
  exit "$result"
}
trap cleanup EXIT
(cd apps/api && go build -o "$stage/worker" ./cmd/worker)
port=$(python3 - <<'PYPORT'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PYPORT
)
# These credentials and keys are synthetic. Empty cleanup state makes no provider
# request; never point this harness at an existing banking environment.
env -i PATH="$PATH" \
  WORKER_DATABASE_URL="$BANKING_WORKER_SMOKE_DATABASE_URL" \
  WORKER_ADDR="127.0.0.1:$port" WORKER_SHUTDOWN_TIMEOUT=2s \
  BANKING_ENVIRONMENT=sandbox PLAID_CLIENT_ID=synthetic-client PLAID_SECRET=synthetic-secret \
  BANKING_KEY_CURRENT=smoke BANKING_KEYS='{"smoke":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}' \
  "$stage/worker" >"$stage/worker.log" 2>&1 &
worker_pid=$!
ready=0
for ((attempt=0; attempt<100; attempt++)); do
  if curl --fail --silent --max-time 1 "http://127.0.0.1:$port/ready" >/dev/null; then ready=1; break; fi
  if ! kill -0 "$worker_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then echo 'Worker startup/readiness failed' >&2; exit 1; fi
curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:$port/status" >"$stage/status.json"
python3 - "$stage/status.json" <<'PYSTATUS'
import json, sys
with open(sys.argv[1]) as file:
    status = json.load(file)
assert status == {
    'sample_limit': 100, 'sampled_operations': 0, 'sample_may_be_truncated': False,
    'pending': 0, 'running': 0, 'complete': 0, 'needs_attention': 0,
    'retried_operations': 0, 'oldest_incomplete_age_seconds': 0,
    'max_attempts': 0, 'max_cleanup_progress_rows': 0,
    'oldest_local_import_lag_seconds': 0,
}, 'smoke requires an empty disposable banking queue'
PYSTATUS
kill -TERM "$worker_pid"
for ((attempt=0; attempt<100; attempt++)); do
  if ! kill -0 "$worker_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if kill -0 "$worker_pid" 2>/dev/null; then echo 'Worker graceful shutdown exceeded deadline' >&2; exit 1; fi
wait "$worker_pid"
worker_pid=
if curl --fail --silent --max-time 1 "http://127.0.0.1:$port/ready" >/dev/null; then
  echo 'Worker listener survived shutdown' >&2
  exit 1
fi
echo 'Actual banking worker readiness, private status and SIGTERM shutdown passed'
