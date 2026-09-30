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
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
# Lint under the function owner: plpgsql_check does not apply SECURITY DEFINER
# ownership when called by the non-inheriting migration login. No ACL is widened.
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c "CREATE EXTENSION IF NOT EXISTS plpgsql_check WITH SCHEMA public"
scripts/db-tool.sh supabase db lint --db-url "postgres://postgres:postgres@127.0.0.1:$port/postgres?options=-c%20role%3Dkami_migrator" --schema app --fail-on warning --workdir "$stage"

# Desired SQL is applied only to this throwaway comparison database, not as a
# deployment runner. Managed provider schemas came from the clean template.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/roles.sql
role_snapshot() {
  docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolconnlimit, rolconfig FROM pg_roles WHERE rolname IN ('kami_api','kami_migrator') ORDER BY rolname; SELECT roleid::regrole, member::regrole, admin_option, inherit_option, set_option FROM pg_auth_members WHERE roleid IN ('kami_api'::regrole,'kami_migrator'::regrole) OR member IN ('kami_api'::regrole,'kami_migrator'::regrole) ORDER BY 1,2;"
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
# Keep local synthetic provider credentials out of command output and arguments.
# The disposable directory is removed by the existing cleanup trap.
scripts/db-tool.sh supabase status --output json --workdir "$stage" > "$stage/auth-status.json"
chmod 600 "$stage/auth-status.json"
cd apps/api
TEST_DATABASE_URL="postgres://kami_api:kami-local-only@127.0.0.1:$port/postgres?sslmode=disable" \
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
# Database permission probes temporarily change cluster roles; packages sharing
# this cluster must run serially. Tests inside each package still exercise races.
sys.exit(subprocess.run([
    "go", "test", "-p=1", "-race", "-tags=integration", "-count=1",
    "./internal/database/...", "./internal/auth/...", "./internal/invitation/...",
    "./internal/expense/...", "./internal/graph/...", "./internal/onboarding/...",
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
