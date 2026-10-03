#!/usr/bin/env bash
set -euo pipefail
required=(
  GCP_PROJECT_ID GCP_REGION GCP_ARTIFACT_REPOSITORY
  GCP_CLOUD_RUN_SERVICE GCP_RUNTIME_SERVICE_ACCOUNT
  GCP_WORKLOAD_IDENTITY_PROVIDER GCP_DEPLOY_SERVICE_ACCOUNT
  SUPABASE_PROJECT_REF SUPABASE_PUBLISHABLE_KEY
  PRODUCTION_WEB_ORIGIN INVITATION_FROM
  DATABASE_URL_SECRET_VERSION SUPABASE_CA_SECRET_VERSION
  CURSOR_SIGNING_KEYS_SECRET_VERSION
  INVITATION_KEYS_SECRET_VERSION ONBOARDING_AUTH_ADMIN_KEY_SECRET_VERSION
  RESEND_API_KEY_SECRET_VERSION
  SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD DEPLOY_SHA
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required production setting: $name" >&2
    exit 1
  fi
done
[[ "$GCP_PROJECT_ID" == "kami-finances-production" ]] || exit 1
[[ "$GCP_REGION" == "us-west1" ]] || exit 1
[[ "$GCP_ARTIFACT_REPOSITORY" == "kami-split" ]] || exit 1
[[ "$GCP_CLOUD_RUN_SERVICE" == "kami-split-api" ]] || exit 1
[[ "$SUPABASE_PROJECT_REF" == "zlxpapkxacnwnmgagbth" ]] || exit 1
[[ "$PRODUCTION_WEB_ORIGIN" == https://* ]] || exit 1
[[ "$PRODUCTION_WEB_ORIGIN" != */ ]] || exit 1
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
secret_versions=(
  DATABASE_URL_SECRET_VERSION SUPABASE_CA_SECRET_VERSION
  CURSOR_SIGNING_KEYS_SECRET_VERSION
  INVITATION_KEYS_SECRET_VERSION ONBOARDING_AUTH_ADMIN_KEY_SECRET_VERSION
  RESEND_API_KEY_SECRET_VERSION
)
for name in "${secret_versions[@]}"; do
  [[ "${!name}" =~ ^[1-9][0-9]*$ ]] || {
    echo "Production secret version must be a positive integer: $name" >&2
    exit 1
  }
done
