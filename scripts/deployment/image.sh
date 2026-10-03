#!/usr/bin/env bash
set -euo pipefail
registry="${GCP_REGION}-docker.pkg.dev"
image_tag="${registry}/${GCP_PROJECT_ID}/${GCP_ARTIFACT_REPOSITORY}/api:${DEPLOY_SHA}-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
gcloud auth configure-docker "$registry" --quiet
docker build --target runtime --tag "$image_tag" --file source/apps/api/Dockerfile source
docker push "$image_tag"
digest="$(gcloud artifacts docker images describe "$image_tag" \
  --format='value(image_summary.digest)')"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
image_ref="${image_tag%:*}@${digest}"
echo "ref=$image_ref" >> "$GITHUB_OUTPUT"
