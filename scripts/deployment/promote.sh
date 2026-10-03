#!/usr/bin/env bash
set -euo pipefail
[[ "${DEPLOY_MODE:?}" == release ]] || { echo "Promotion requires release mode" >&2; exit 1; }
gcloud run services update-traffic "$GCP_CLOUD_RUN_SERVICE" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --to-revisions "${CANDIDATE_REVISION}=100" \
  --quiet
service_json="$(gcloud run services describe "$GCP_CLOUD_RUN_SERVICE" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
  --format=json)"
serving_revision="$(jq --raw-output \
  '.status.traffic[] | select(.percent == 100) | .revisionName' \
  <<< "$service_json")"
[[ "$serving_revision" == "$CANDIDATE_REVISION" ]] || exit 1
curl --fail --silent --show-error --max-time 30 --retry 5 --retry-all-errors \
  --retry-delay 2 "${SERVICE_URL}/health"
curl --fail --silent --show-error --max-time 30 --retry 5 --retry-all-errors \
  --retry-delay 2 "${SERVICE_URL}/ready"
gcloud run services update-traffic "$GCP_CLOUD_RUN_SERVICE" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --remove-tags "$CANDIDATE_TAG" \
  --quiet
echo "url=$SERVICE_URL" >> "$GITHUB_OUTPUT"
