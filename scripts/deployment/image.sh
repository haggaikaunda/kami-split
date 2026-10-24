#!/usr/bin/env bash
set -euo pipefail
registry="${GCP_REGION}-docker.pkg.dev"
image_tag="${registry}/${GCP_PROJECT_ID}/${GCP_ARTIFACT_REPOSITORY}/api:${DEPLOY_SHA}-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
gcloud auth configure-docker "$registry" --quiet
build_args=(--platform linux/amd64 --target runtime --load)
cache_root="${RUNNER_TEMP:?}/api-build-cache"
if [[ -f "$cache_root/index.json" ]]; then
  build_args+=(--cache-from "type=local,src=$cache_root")
fi
# Buildx prepares local export paths before ignore-error takes effect. Only use
# an owned fresh directory; a collision or setup failure must disable export.
cache_export_root="${cache_root}-export"
cache_export=false
if mkdir "$cache_export_root" 2>/dev/null; then
  cache_export=true
  build_args+=(--cache-to "type=local,dest=$cache_export_root,mode=max,ignore-error=true")
else
  echo '::warning::API build cache export disabled because its directory could not be created' >&2
fi
docker buildx build "${build_args[@]}" --tag "$image_tag" \
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
if [[ "$cache_export" == true && -f "$cache_export_root/index.json" ]]; then
  if rm -rf "$cache_root" && mv "$cache_export_root" "$cache_root"; then
    echo "cache_ready=true" >> "$GITHUB_OUTPUT"
  else
    echo '::warning::API build cache could not be prepared for saving' >&2
  fi
fi
