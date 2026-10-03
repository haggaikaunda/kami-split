#!/usr/bin/env bash
set -euo pipefail
curl --fail --silent --show-error --max-time 30 --retry 5 --retry-all-errors \
  --retry-delay 2 "${CANDIDATE_URL}/health" > /dev/null
curl --fail --silent --show-error --max-time 30 --retry 5 --retry-all-errors \
  --retry-delay 2 "${CANDIDATE_URL}/ready" > /dev/null
health="$(curl --fail --silent --show-error --max-time 30 --header 'Content-Type: application/json' --data '{"query":"{ health { status } }"}' "${CANDIDATE_URL}/graphql")"
jq --exit-status '.data.health.status == "ok" and (.errors == null)' <<< "$health" > /dev/null
