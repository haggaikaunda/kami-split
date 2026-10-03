#!/usr/bin/env bash
set -euo pipefail
snapshot="${RUNNER_TEMP:?}/rehearsal-traffic.json"
case "${1:-}" in before|after) ;; *) exit 1;; esac
# Earlier failures may occur before the snapshot and before any service mutation.
if [[ "$1" == after && ! -f "$snapshot" ]]; then exit 0; fi
service="$(gcloud run services describe "$GCP_CLOUD_RUN_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
if [[ "$1" == before ]]; then
  # Fail closed for LATEST routing rather than changing production's allocation.
  jq --exit-status 'all(.spec.traffic[]; ((.percent // 0) == 0) or (.latestRevision != true and (.revisionName | type == "string")))' <<< "$service" > /dev/null
fi
allocation="$(jq --compact-output '[.status.traffic[] | select((.percent // 0) > 0) | {revisionName, percent}] | sort_by(.revisionName)' <<< "$service")"
jq --exit-status 'length > 0 and (map(.percent) | add) == 100' <<< "$allocation" > /dev/null
if [[ "$1" == before ]]; then
  printf '%s\n' "$allocation" > "$snapshot"
else
  [[ "$allocation" == "$(cat "$snapshot")" ]] || { echo 'Production traffic changed during rehearsal' >&2; exit 1; }
  echo 'Production serving revisions and percentages are unchanged'
fi
