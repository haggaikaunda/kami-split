#!/usr/bin/env bash
set -euo pipefail
registry="${GCP_REGION}-docker.pkg.dev"
image_tag="${registry}/${GCP_PROJECT_ID}/${GCP_ARTIFACT_REPOSITORY}/api:${DEPLOY_SHA}-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
gcloud auth configure-docker "$registry" --quiet
cache_args=()
cache_root="${RUNNER_TEMP:?}/api-build-cache"
if [[ -f "$cache_root/index.json" ]]; then
  cache_args+=(--cache-from "type=local,src=$cache_root")
fi
# A new export directory avoids retaining old blobs after each cache restore.
# Cache export is advisory; compilation/publication must still succeed.
cache_args+=(--cache-to "type=local,dest=${cache_root}-export,mode=max,ignore-error=true")
docker buildx build --platform linux/amd64 --target runtime --load \
  "${cache_args[@]}" --tag "$image_tag" \
  --label "org.opencontainers.image.revision=$DEPLOY_SHA" \
  --file source/apps/api/Dockerfile source
docker push "$image_tag"
digest="$(gcloud artifacts docker images describe "$image_tag" \
  --format='value(image_summary.digest)')"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
image_ref="${image_tag%:*}@${digest}"
echo "ref=$image_ref" >> "$GITHUB_OUTPUT"
# Restore and save must use the same path: Actions includes paths in its cache
# version. Replace the restored layout only after a complete successful export.
if [[ -f "${cache_root}-export/index.json" ]]; then
  if rm -rf "$cache_root" && mv "${cache_root}-export" "$cache_root"; then
    echo "cache_ready=true" >> "$GITHUB_OUTPUT"
  else
    echo '::warning::API build cache could not be prepared for saving' >&2
  fi
fi
