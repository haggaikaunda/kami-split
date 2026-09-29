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
cp -R supabase/migrations supabase/seeds "$stage/supabase/"
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
# CLI is the sole migration runner: reset tests fresh replay; up tests that an
# already-applied history is a no-op. Initial release upgrades the empty app state.
scripts/db-tool.sh supabase db reset --local --workdir "$stage"
scripts/db-tool.sh supabase migration up --local --workdir "$stage"
scripts/db-tool.sh supabase db lint --local --schema app --fail-on warning --workdir "$stage"

# Desired SQL is applied only to this throwaway comparison database, not as a
# deployment runner. Provider schemas are neither copied nor redefined.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/roles.sql
role_snapshot() {
  docker exec "$container" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolconnlimit, rolconfig FROM pg_roles WHERE rolname IN ('kami_api','kami_migrator') ORDER BY rolname; SELECT roleid::regrole, member::regrole, admin_option, inherit_option, set_option FROM pg_auth_members WHERE roleid IN ('kami_api'::regrole,'kami_migrator'::regrole) OR member IN ('kami_api'::regrole,'kami_migrator'::regrole) ORDER BY 1,2;"
}
role_snapshot > "$stage/migration-roles.txt"
docker exec "$container" createdb -U postgres kami_desired
for file in supabase/schemas/*.sql; do
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d kami_desired < "$file"
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
# Additional cluster-role and effective default-grant assertions run against the
# migration replay, followed by real authenticated runtime integration tests.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/roles.sql
scripts/check-sqlc.sh
cd apps/api
TEST_DATABASE_URL="postgres://kami_api:kami-local-only@127.0.0.1:$port/postgres?sslmode=disable" \
TEST_DATABASE_ADMIN_URL="postgres://postgres:postgres@127.0.0.1:$port/postgres?sslmode=disable" \
  go test -race -tags=integration -count=1 ./internal/database/...
cd "$root"
