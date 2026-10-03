#!/usr/bin/env bash
set -euo pipefail
[[ "${PR_NUMBER:?}" =~ ^[1-9][0-9]{0,9}$ ]] || exit 1
[[ "${GCP_PROJECT_ID:?}" == kami-finances-production ]] || exit 1
[[ "${GCP_REGION:?}" == us-west1 ]] || exit 1
[[ "${GCP_CLOUD_RUN_SERVICE:?}" == kami-split-api ]] || exit 1
state="$(gh api "repos/${GITHUB_REPOSITORY:?}/pulls/${PR_NUMBER}" --jq .state)"
case "$state" in
  open) echo 'PR is open; retaining candidate tag'; exit 0;;
  closed) ;;
  *) echo 'Unexpected PR state' >&2; exit 1;;
esac
bash scripts/deployment/traffic.sh before
service="$(gcloud run services describe "$GCP_CLOUD_RUN_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
if jq --exit-status --arg tag "pr-$PR_NUMBER" 'any(.status.traffic[]; .tag == $tag)' <<< "$service" > /dev/null; then
  gcloud run services update-traffic "$GCP_CLOUD_RUN_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --remove-tags "pr-$PR_NUMBER" --quiet
fi
bash scripts/deployment/traffic.sh after
