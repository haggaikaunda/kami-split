#!/usr/bin/env bash
set -euo pipefail

# A successful empty lookup is the only case that permits first-service creation.
service="$(gcloud run services list \
  --project "${GCP_PROJECT_ID:?}" \
  --region "${GCP_REGION:?}" \
  --filter="metadata.name=${GCP_CLOUD_RUN_SERVICE:?}" \
  --format='value(metadata.name)')"

case "$service" in
  "") ;;
  "$GCP_CLOUD_RUN_SERVICE") printf '%s\n' '--no-traffic' ;;
  *) echo 'Unexpected Cloud Run service lookup result' >&2; exit 1 ;;
esac
