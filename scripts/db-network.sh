#!/usr/bin/env bash
# Use Docker's supported default host-binding option before CLI creates containers.
set -euo pipefail
project=${1:?Supabase project ID required}
case "$project" in kami-split|kami-split-test-[0-9]*-[0-9]*) ;; *) echo 'Unexpected project ID' >&2; exit 1;; esac
network="supabase_network_$project"
if docker network inspect "$network" >/dev/null 2>&1; then
  actual=$(docker network inspect --format '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}/{{index .Labels "com.supabase.cli.project"}}' "$network")
  [[ "$actual" == "127.0.0.1/$project" ]] || { echo "Network $network has incompatible ownership/binding; stop its stack before retrying" >&2; exit 1; }
else
  docker network create --label "com.supabase.cli.project=$project" \
    --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 "$network" >/dev/null
fi
