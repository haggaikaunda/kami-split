#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
cat > "$fixture/gcloud" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == 'run services list --project test-project --region us-west1 --filter=metadata.name=kami-split-api --format=value(metadata.name)' ]] || exit 99
printf '%s' "$MOCK_RESPONSE"
exit "$MOCK_STATUS"
MOCK
chmod +x "$fixture/gcloud"
export PATH="$fixture:$PATH"
export GCP_PROJECT_ID=test-project GCP_REGION=us-west1 GCP_CLOUD_RUN_SERVICE=kami-split-api
export MOCK_RESPONSE='' MOCK_STATUS=0

[[ "$(bash scripts/cloud-run-traffic-flag.sh)" == '' ]]
MOCK_RESPONSE=kami-split-api
[[ "$(bash scripts/cloud-run-traffic-flag.sh)" == '--no-traffic' ]]

# Authentication/network errors, even with partial stdout, cannot become creation.
for MOCK_RESPONSE in '' kami-split-api; do
  MOCK_STATUS=1
  if bash scripts/cloud-run-traffic-flag.sh > "$fixture/output" 2> "$fixture/error"; then
    echo 'Expected failed lookup to stop deployment' >&2
    exit 1
  fi
  [[ ! -s "$fixture/output" ]]
done
MOCK_STATUS=0
for MOCK_RESPONSE in other-service $'kami-split-api\nother-service'; do
  if bash scripts/cloud-run-traffic-flag.sh > "$fixture/output" 2> "$fixture/error"; then
    echo 'Expected unexpected service results to stop deployment' >&2
    exit 1
  fi
  [[ ! -s "$fixture/output" ]]
done
echo 'Cloud Run traffic selection: 6 cases passed'
