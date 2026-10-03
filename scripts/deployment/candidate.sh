#!/usr/bin/env bash
set -euo pipefail
case "${DEPLOY_MODE:?}" in rehearsal|release) ;; *) exit 1;; esac
supabase_origin="https://${SUPABASE_PROJECT_REF}.supabase.co"
candidate_tag="candidate-${DEPLOY_SHA:0:12}"
traffic_flag="$(bash scripts/cloud-run-traffic-flag.sh)"
revision_args=(--labels "deployment-purpose=release,commit-sha=${DEPLOY_SHA}" --remove-labels pr-number)
if [[ "${DEPLOY_MODE:?}" == rehearsal ]]; then
  [[ "$traffic_flag" == --no-traffic ]] || { echo "Rehearsal requires an existing service" >&2; exit 1; }
  candidate_tag="pr-${PR_NUMBER:?}"
  suffix="pr-${PR_NUMBER}-${DEPLOY_SHA:0:12}-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
  [[ ${#GCP_CLOUD_RUN_SERVICE}+${#suffix}+1 -le 63 ]] || exit 1
  revision_args=(--revision-suffix "$suffix" --labels "deployment-purpose=rehearsal,pr-number=${PR_NUMBER},commit-sha=${DEPLOY_SHA}")
fi
traffic_args=()
if [[ -n "$traffic_flag" ]]; then
  traffic_args+=("$traffic_flag")
fi
gcloud run deploy "$GCP_CLOUD_RUN_SERVICE" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --image "$IMAGE_REF" \
  "${traffic_args[@]}" \
  --tag "$candidate_tag" \
  "${revision_args[@]}" \
  --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT" \
  --port 8080 \
  --cpu 1 \
  --memory 512Mi \
  --cpu-throttling \
  --min-instances 0 \
  --max-instances 1 \
  --timeout 60s \
  --allow-unauthenticated \
  --set-env-vars "API_ADDR=:8080,API_SHUTDOWN_TIMEOUT=5s,DATABASE_MAX_CONNS=5,DATABASE_TIMEOUT=2s,AUTH_ISSUER=${supabase_origin}/auth/v1,AUTH_AUDIENCE=authenticated,AUTH_JWKS_URL=${supabase_origin}/auth/v1/.well-known/jwks.json,ONBOARDING_AUTH_URL=${supabase_origin}/auth/v1,ONBOARDING_AUTH_PUBLIC_KEY=${SUPABASE_PUBLISHABLE_KEY},ONBOARDING_ORIGIN=${PRODUCTION_WEB_ORIGIN},INVITATION_FROM=${INVITATION_FROM},CURSOR_ACTIVE_KEY_ID=production-v1,INVITATION_ACTIVE_KEY_ID=production-v1" \
  --set-secrets "DATABASE_URL=kami-split-database-url:${DATABASE_URL_SECRET_VERSION},/var/run/secrets/kami-split/supabase-ca.crt=kami-split-supabase-ca:${SUPABASE_CA_SECRET_VERSION},CURSOR_SIGNING_KEYS=kami-split-cursor-signing-keys:${CURSOR_SIGNING_KEYS_SECRET_VERSION},INVITATION_KEYS=kami-split-invitation-keys:${INVITATION_KEYS_SECRET_VERSION},ONBOARDING_AUTH_ADMIN_KEY=kami-split-onboarding-auth-admin-key:${ONBOARDING_AUTH_ADMIN_KEY_SECRET_VERSION},RESEND_API_KEY=kami-split-resend-api-key:${RESEND_API_KEY_SECRET_VERSION}" \
  --quiet

service_json="$(gcloud run services describe "$GCP_CLOUD_RUN_SERVICE" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
revision_name="$(jq --raw-output --arg tag "$candidate_tag" '.status.traffic[] | select(.tag == $tag) | .revisionName' <<< "$service_json")"
candidate_url="$(jq --raw-output --arg tag "$candidate_tag" \
  '.status.traffic[] | select(.tag == $tag) | .url' <<< "$service_json")"
service_url="$(jq --raw-output '.status.url' <<< "$service_json")"
[[ "$revision_name" == "${GCP_CLOUD_RUN_SERVICE}-"* ]] || exit 1
if [[ "$DEPLOY_MODE" == rehearsal ]]; then
  [[ "$revision_name" == "${GCP_CLOUD_RUN_SERVICE}-${suffix}" ]] || exit 1
  jq --exit-status --arg revision "$revision_name" 'all(.status.traffic[]; .revisionName != $revision or (.percent // 0) == 0)' <<< "$service_json" > /dev/null
fi
[[ "$candidate_url" == https://* ]] || exit 1
[[ "$service_url" == https://* ]] || exit 1
echo "revision=$revision_name" >> "$GITHUB_OUTPUT"
echo "tag=$candidate_tag" >> "$GITHUB_OUTPUT"
echo "url=$candidate_url" >> "$GITHUB_OUTPUT"
echo "service_url=$service_url" >> "$GITHUB_OUTPUT"
