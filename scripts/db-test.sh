#!/usr/bin/env bash
# Creates only a unique disposable Supabase project; never resets development data.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
stage=$(mktemp -d)
project="kami-split-test-$(date +%s)-$$"
cleanup() {
  result=$?
  "$root/scripts/db-tool.sh" supabase stop --project-id "$project" --no-backup || result=1
  rm -rf "$stage"
  exit "$result"
}
trap cleanup EXIT
mkdir -p "$stage/supabase"
cp supabase/config.toml "$stage/supabase/"
cp -R supabase/seeds "$stage/supabase/"
cp -R supabase/templates "$stage/supabase/"
mkdir -p "$stage/supabase/migrations"
# Start with the provider plus the already shipped #74 foundation only.
cp supabase/migrations/20260929000000_foundation.sql "$stage/supabase/migrations/"
# Reserve four unused loopback ports during selection. Docker binding still fails
# safely if another process races us; no shared stack is stopped or reset.
python3 - "$stage/supabase/config.toml" "$project" <<'PY'
import socket, sys
path, project = sys.argv[1:]
text = open(path).read().replace('project_id = "kami-split"', f'project_id = "{project}"')
sockets = [socket.socket() for _ in range(4)]
for sock, old in zip(sockets, [55421, 55422, 55420, 55424]):
    sock.bind(('127.0.0.1', 0))
    text = text.replace(str(old), str(sock.getsockname()[1]))
open(path, 'w').write(text)
PY
scripts/db-tool.sh supabase start --workdir "$stage"
container="supabase_db_$project"
port=$(python3 - "$stage/supabase/config.toml" <<'PY'
import sys, tomllib
with open(sys.argv[1], 'rb') as f: print(tomllib.load(f)['db']['port'])
PY
)
# Clone the actual provider database before new app migrations. The desired-state
# database retains managed Auth objects verbatim; no hand-built provider stub.
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d template1 -c "ALTER DATABASE postgres ALLOW_CONNECTIONS false"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d template1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'postgres'"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d template1 -c "CREATE DATABASE kami_desired TEMPLATE postgres"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d template1 -c "ALTER DATABASE postgres ALLOW_CONNECTIONS true"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d kami_desired -c "SET ROLE kami_migrator; DROP SCHEMA app CASCADE"
cp supabase/migrations/*.sql "$stage/supabase/migrations/"
# Seed a real #75 group before the additive group-creation migration. Compare
# its complete rows afterwards, proving IDs, ownership and designation survive.
group_migration="$stage/supabase/migrations/20261003000000_group_creation.sql"
household_migration="$stage/supabase/migrations/20261005000000_household_designation.sql"
mv "$household_migration" "$stage/household-designation.sql"
mv "$group_migration" "$stage/group-creation.sql"
repayment_migration="$stage/supabase/migrations/20261006000000_repayments.sql"
mv "$repayment_migration" "$stage/repayments.sql"
mv "$stage/supabase/migrations/20261004000000_group_metadata_read.sql" "$stage/group-metadata-read.sql"
mv "$stage/supabase/migrations/20261007000000_shared_invitations.sql" "$stage/shared-invitations.sql"
mv "$stage/supabase/migrations/20261008000000_onboarding_continuation.sql" "$stage/onboarding-continuation.sql"
mv "$stage/supabase/migrations/20261009000000_household_dashboard.sql" "$stage/household-dashboard.sql"
mv "$stage/supabase/migrations/20261010000000_expense_view.sql" "$stage/expense-view.sql"
mv "$stage/supabase/migrations/20261011000000_household_membership.sql" "$stage/household-membership.sql"
mv "$stage/supabase/migrations/20261012000000_retire_household_designation.sql" "$stage/retire-household-designation.sql"
mv "$stage/supabase/migrations/20261013000000_self_profile.sql" "$stage/self-profile.sql"
mv "$stage/supabase/migrations/20261014000000_percentage_splits.sql" "$stage/percentage-splits.sql"
mv "$stage/supabase/migrations/20261015000000_expense_editing.sql" "$stage/expense-editing.sql"
mv "$stage/supabase/migrations/20261016000000_appearance.sql" "$stage/appearance.sql"
mv "$stage/supabase/migrations/20261017000000_system_appearance_default.sql" "$stage/system-appearance-default.sql"
mv "$stage/supabase/migrations/20261017010000_banking_store.sql" "$stage/banking-store.sql"
mv "$stage/supabase/migrations/20261018000000_banking_worker.sql" "$stage/banking-worker.sql"
mv "$stage/supabase/migrations/20261019000000_banking_enrollment.sql" "$stage/banking-enrollment.sql"
mv "$stage/supabase/migrations/20261020030000_banking_lifecycle.sql" "$stage/banking-lifecycle.sql"
mv "$stage/supabase/migrations/20261020040000_banking_replacement.sql" "$stage/banking-replacement.sql"
mv "$stage/supabase/migrations/20261021000000_banking_sync.sql" "$stage/banking-sync.sql"
mv "$stage/supabase/migrations/20261021010000_banking_initial_sync.sql" "$stage/banking-initial-sync.sql"
mv "$stage/supabase/migrations/20261022000000_banking_background_sync.sql" "$stage/banking-background-sync.sql"
mv "$stage/supabase/migrations/20261022010000_banking_status.sql" "$stage/banking-status.sql"
mv "$stage/supabase/migrations/20261022015000_banking_pfc.sql" "$stage/banking-pfc.sql"
mv "$stage/supabase/migrations/20261022020000_banking_reporting.sql" "$stage/banking-reporting.sql"
mv "$stage/supabase/migrations/20261023000000_banking_institution_name.sql" "$stage/banking-institution-name.sql"
mv "$stage/supabase/migrations/20261020020000_reporting_timezone.sql" "$stage/reporting-timezone.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/group_creation_upgrade.sql
mv "$stage/group-creation.sql" "$group_migration"
mv "$stage/group-metadata-read.sql" "$stage/supabase/migrations/20261004000000_group_metadata_read.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
# Preserve the existing identity/group/Household fixture through the new
# designation foundation as well. Neither ownership nor installation identity
# may infer a partner or alter an existing membership.
mv "$stage/household-designation.sql" "$household_migration"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/group_creation_upgraded.sql
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/repayment_upgrade.sql
mv "$stage/repayments.sql" "$repayment_migration"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/repayment_upgraded.sql
# Apply shared links after all earlier upgrade fixtures; each migration version
# is unique so Supabase records and replays the sequence deterministically.
mv "$stage/shared-invitations.sql" "$stage/supabase/migrations/20261007000000_shared_invitations.sql"
mv "$stage/onboarding-continuation.sql" "$stage/supabase/migrations/20261008000000_onboarding_continuation.sql"
mv "$stage/household-dashboard.sql" "$stage/supabase/migrations/20261009000000_household_dashboard.sql"
mv "$stage/expense-view.sql" "$stage/supabase/migrations/20261010000000_expense_view.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
# Exercise old deployed identities/admission/history before membership policy.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/household_membership_upgrade.sql
mv "$stage/household-membership.sql" "$stage/supabase/migrations/20261011000000_household_membership.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/household_membership_upgraded.sql
# Retire only obsolete operations after the compatible membership upgrade.
# Nonempty legacy rows/audits must survive without fabricated consent events.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/household_designation_retirement_upgrade.sql
mv "$stage/retire-household-designation.sql" "$stage/supabase/migrations/20261012000000_retire_household_designation.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/household_designation_retirement_upgraded.sql
mv "$stage/self-profile.sql" "$stage/supabase/migrations/20261013000000_self_profile.sql"
mv "$stage/percentage-splits.sql" "$stage/supabase/migrations/20261014000000_percentage_splits.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/expense_editing_upgrade.sql
mv "$stage/expense-editing.sql" "$stage/supabase/migrations/20261015000000_expense_editing.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/expense_editing_upgraded.sql
mv "$stage/appearance.sql" "$stage/supabase/migrations/20261016000000_appearance.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/appearance_upgraded.sql
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/system_appearance_upgrade.sql
mv "$stage/system-appearance-default.sql" "$stage/supabase/migrations/20261017000000_system_appearance_default.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/system_appearance_upgraded.sql
mv "$stage/banking-store.sql" "$stage/supabase/migrations/20261017010000_banking_store.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/banking_worker_upgrade.sql
mv "$stage/banking-worker.sql" "$stage/supabase/migrations/20261018000000_banking_worker.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/banking_worker_upgraded.sql
mv "$stage/banking-enrollment.sql" "$stage/supabase/migrations/20261019000000_banking_enrollment.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
mv "$stage/reporting-timezone.sql" "$stage/supabase/migrations/20261020020000_reporting_timezone.sql"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
# Production has already applied the timezone migration. Exercise the normal
# deployment push from that recorded base, with real preference/history rows.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/banking_lifecycle_upgrade.sql
mv "$stage/banking-lifecycle.sql" "$stage/supabase/migrations/20261020030000_banking_lifecycle.sql"
lifecycle_db_url="postgres://postgres:postgres@127.0.0.1:$port/postgres"
scripts/db-tool.sh supabase db push --db-url "$lifecycle_db_url" --dry-run --workdir "$stage"
scripts/db-tool.sh supabase db push --db-url "$lifecycle_db_url" --yes --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/banking_lifecycle_upgraded.sql
# Repeating the same ordinary push must be a no-op, without out-of-order flags.
scripts/db-tool.sh supabase db push --db-url "$lifecycle_db_url" --yes --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/banking_replacement_upgrade.sql
mv "$stage/banking-replacement.sql" "$stage/supabase/migrations/20261020040000_banking_replacement.sql"
scripts/db-tool.sh supabase db push --db-url "$lifecycle_db_url" --yes --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/banking_replacement_upgraded.sql
mv "$stage/banking-sync.sql" "$stage/supabase/migrations/20261021000000_banking_sync.sql"
mv "$stage/banking-initial-sync.sql" "$stage/supabase/migrations/20261021010000_banking_initial_sync.sql"
# Reconstruct the actual last deployed history: status is installed while the
# older background-sync migration is absent. No migration history is fabricated.
mv "$stage/banking-status.sql" "$stage/supabase/migrations/20261022010000_banking_status.sql"
scripts/db-tool.sh supabase db push --db-url "$lifecycle_db_url" --yes --workdir "$stage"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/banking_background_upgrade.sql
mv "$stage/banking-background-sync.sql" "$stage/supabase/migrations/20261022000000_banking_background_sync.sql"
mv "$stage/banking-pfc.sql" "$stage/supabase/migrations/20261022015000_banking_pfc.sql"
mv "$stage/banking-reporting.sql" "$stage/supabase/migrations/20261022020000_banking_reporting.sql"
mv "$stage/banking-institution-name.sql" "$stage/supabase/migrations/20261023000000_banking_institution_name.sql"
if scripts/db-tool.sh supabase db push --db-url "$lifecycle_db_url" --dry-run --workdir "$stage" > "$stage/ordinary-push.log" 2>&1; then
  echo 'Ordinary push unexpectedly accepted out-of-order migration' >&2
  exit 1
fi
# Distinguish the intended ordering rejection from unrelated connection failures.
grep -q -- '--include-all' "$stage/ordinary-push.log"
scripts/db-tool.sh supabase migration list --output-format json --db-url "$lifecycle_db_url" --workdir "$stage" > "$stage/migration-history.txt"
cat "$stage/migration-history.txt"
MIGRATION_TEST_URL="$lifecycle_db_url" MIGRATION_TEST_WORKDIR="$stage" node --input-type=module <<'RECOVERY_TEST'
import { execFileSync } from 'node:child_process';
import { pushMigrations } from './scripts/deployment/migrations.mjs';
const options = {
 mode: 'release', target: ['--db-url', process.env.MIGRATION_TEST_URL],
 workdir: process.env.MIGRATION_TEST_WORKDIR,
 directory: `${process.env.MIGRATION_TEST_WORKDIR}/supabase/migrations`,
 run: args => execFileSync('./scripts/db-tool.sh', ['supabase', ...args], {encoding: 'utf8', stdio: ['ignore','pipe','inherit']}),
};
if (!pushMigrations(options).includeAll) throw new Error('Recovery exception was not exercised');
if (pushMigrations(options).missing.length) throw new Error('Repeated recovery must be a no-op');
RECOVERY_TEST
# Synthetic-only row deltas stay in ignored run output for diagnosis. The
# comparison excludes only the newly added nullable taxonomy column; its null
# value is asserted separately below, so retained facts cannot be rewritten.
mkdir -p test-results
docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT jsonb_build_object('before',to_jsonb(s),'after',jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM app.users u),'groups',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM app.groups g),'expenses',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM app.expenses e),'sources',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM app.banking_sources b),'revisions',(SELECT jsonb_agg(to_jsonb(r)-'provider_primary_category' ORDER BY source_id,revision) FROM app.banking_source_revisions r),'preferences',(SELECT jsonb_agg(to_jsonb(p) ORDER BY owner_id) FROM app.reporting_timezones p),'work_count',(SELECT count(*) FROM app.banking_work))) FROM public.banking_background_snapshot s" > test-results/banking-background-comparison.json
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/banking_background_upgraded.sql
# Lint under the function owner: plpgsql_check does not apply SECURITY DEFINER
# ownership when called by the non-inheriting migration login. No ACL is widened.
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c "CREATE EXTENSION IF NOT EXISTS plpgsql_check WITH SCHEMA public"
scripts/db-tool.sh supabase db lint --db-url "postgres://postgres:postgres@127.0.0.1:$port/postgres?options=-c%20role%3Dkami_migrator" --schema app --fail-on warning --workdir "$stage"

# Desired SQL is applied only to this throwaway comparison database, not as a
# deployment runner. Managed provider schemas came from the clean template.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/roles.sql
role_snapshot() {
  docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolconnlimit, rolconfig FROM pg_roles WHERE rolname IN ('kami_api','kami_migrator','kami_worker') ORDER BY rolname; SELECT roleid::regrole, member::regrole, admin_option, inherit_option, set_option FROM pg_auth_members WHERE roleid IN ('kami_api'::regrole,'kami_migrator'::regrole,'kami_worker'::regrole) OR member IN ('kami_api'::regrole,'kami_migrator'::regrole,'kami_worker'::regrole) ORDER BY 1,2;"
}
role_snapshot > "$stage/migration-roles.txt"
for file in supabase/schemas/*.sql; do
  docker exec -i "$container" psql -X -1 -v ON_ERROR_STOP=1 -U postgres -d kami_desired < "$file"
done
# Include schema objects, ownership, ACLs and default privileges. pg_dump's
# random restriction token is the sole nondeterministic content removed.
for db in postgres kami_desired; do
  docker exec "$container" pg_dump -U postgres -d "$db" --schema-only --schema app \
    | sed '/^\\restrict /d; /^\\unrestrict /d' > "$stage/$db.sql"
done
diff -u "$stage/postgres.sql" "$stage/kami_desired.sql"
role_snapshot > "$stage/desired-roles.txt"
diff -u "$stage/migration-roles.txt" "$stage/desired-roles.txt"
# Global default ACLs are not included by pg_dump --schema app.
for db in postgres kami_desired; do
  docker exec "$container" psql -X -At -U postgres -d "$db" -c "SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl FROM pg_default_acl WHERE defaclrole = 'kami_migrator'::regrole ORDER BY 1,2,3" > "$stage/$db.acl"
done
diff -u "$stage/postgres.acl" "$stage/kami_desired.acl"
# Supabase reset recreates the cluster, including comparison databases. Compare
# upgrade/desired state first, then fresh replay against the saved exact snapshot.
scripts/db-tool.sh supabase db reset --local --workdir "$stage"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
docker exec "$container" pg_dump -U postgres -d postgres --schema-only --schema app \
  | sed '/^\\restrict /d; /^\\unrestrict /d' > "$stage/fresh.sql"
diff -u "$stage/postgres.sql" "$stage/fresh.sql"
role_snapshot > "$stage/fresh-roles.txt"
diff -u "$stage/migration-roles.txt" "$stage/fresh-roles.txt"
docker exec "$container" psql -X -At -U postgres -d postgres -c "SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl FROM pg_default_acl WHERE defaclrole = 'kami_migrator'::regrole ORDER BY 1,2,3" > "$stage/fresh.acl"
diff -u "$stage/postgres.acl" "$stage/fresh.acl"
# Additional cluster-role and effective default-grant assertions run against the
# migration replay, followed by real authenticated runtime integration tests.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/roles.sql
scripts/check-sqlc.sh
# Exercise the actual binary before integration fixtures create cleanup jobs.
BANKING_WORKER_SMOKE_DATABASE_URL="postgres://kami_worker:kami-worker-local-only@127.0.0.1:$port/postgres?sslmode=disable" ./scripts/banking-worker-smoke.sh
# Record installed extension/owner/ACL evidence without private queue payloads.
docker exec "$container" psql -X -At -U postgres -d postgres -c "SELECT extname,extversion FROM pg_extension WHERE extname='pgmq'; SELECT relname,pg_get_userbyid(relowner),relacl FROM pg_class WHERE relnamespace='pgmq'::regnamespace AND relname IN('q_banking_lifecycle','a_banking_lifecycle');"
# Keep local synthetic provider credentials out of command output and arguments.
# The disposable directory is removed by the existing cleanup trap.
scripts/db-tool.sh supabase status --output json --workdir "$stage" > "$stage/auth-status.json"
chmod 600 "$stage/auth-status.json"
cd apps/api
TEST_DATABASE_URL="postgres://kami_api:kami-local-only@127.0.0.1:$port/postgres?sslmode=disable" \
TEST_WORKER_DATABASE_URL="postgres://kami_worker:kami-worker-local-only@127.0.0.1:$port/postgres?sslmode=disable" \
TEST_DATABASE_ADMIN_URL="postgres://postgres:postgres@127.0.0.1:$port/postgres?sslmode=disable" \
  python3 - "$stage/auth-status.json" <<'PROVIDER_TEST'
import json, os, subprocess, sys
with open(sys.argv[1]) as status_file:
    status = json.load(status_file)
env = os.environ.copy()
env["TEST_SMTP_URL"] = status["INBUCKET_URL"]
env["TEST_AUTH_URL"] = status["API_URL"].rstrip("/") + "/auth/v1"
env["TEST_AUTH_ANON_KEY"] = status["ANON_KEY"]
env["TEST_AUTH_SERVICE_KEY"] = status["SERVICE_ROLE_KEY"]
env["TEST_AUTH_PUBLISHABLE_KEY"] = status["PUBLISHABLE_KEY"]
env["TEST_AUTH_SECRET_KEY"] = status["SECRET_KEY"]
# Database permission probes temporarily change cluster roles; packages sharing
# this cluster must run serially. Tests inside each package still exercise races.
sys.exit(subprocess.run([
    "go", "test", "-p=1", "-race", "-tags=integration", "-count=1",
    "./internal/database/...", "./internal/auth/...", "./internal/invitation/...",
    "./internal/expense/...", "./internal/graph/...", "./internal/onboarding/...",
    "./internal/bootstrap/...", "./internal/profile/...", "./internal/banking/...",
], env=env).returncode)
PROVIDER_TEST
cd "$root"

# Prove financial history can survive a normal full schema+data dump/replay.
# Clone the real provider database solely to retain managed Auth dependencies,
# then remove only app from the disposable clone and restore the actual dump.
# Superuser is used only inside this local disposable verification container.
docker exec "$container" pg_dump -U supabase_admin -d postgres --schema app > "$stage/financial-backup.sql"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d template1 -c "ALTER DATABASE postgres ALLOW_CONNECTIONS false"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d template1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'postgres'"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d template1 -c "CREATE DATABASE kami_restore TEMPLATE postgres"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d template1 -c "ALTER DATABASE postgres ALLOW_CONNECTIONS true"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d kami_restore -c "DROP SCHEMA app CASCADE"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d kami_restore < "$stage/financial-backup.sql"
for db in postgres kami_restore; do
  docker exec "$container" pg_dump -U supabase_admin -d "$db" --schema app \
    | sed '/^\\restrict /d; /^\\unrestrict /d' > "$stage/$db-restored.sql"
done
diff -u "$stage/postgres-restored.sql" "$stage/kami_restore-restored.sql"
