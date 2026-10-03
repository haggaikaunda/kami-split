#!/usr/bin/env bash
set -euo pipefail
case "${DEPLOY_MODE:?}" in rehearsal|release) ;; *) echo 'Invalid migration mode' >&2; exit 1;; esac
# Use trusted configuration/tools; the selected commit contributes only SQL files.
# Reject links so candidate-controlled paths cannot read files outside its checkout.
python3 - <<'PY'
from pathlib import Path
import shutil
source = Path('source/supabase/migrations')
if source.is_symlink() or source.parent.is_symlink() or not source.is_dir():
    raise SystemExit('Invalid migration directory')
files = list(source.iterdir())
if any(p.is_symlink() or not p.is_file() or p.suffix != '.sql' for p in files):
    raise SystemExit('Only regular SQL migration files are permitted')
target = Path('supabase/migrations')
shutil.rmtree(target)
shutil.copytree(source, target)
PY
./scripts/db-tool.sh supabase link --project-ref "$SUPABASE_PROJECT_REF"
./scripts/db-tool.sh supabase db push --linked --dry-run
if [[ "$DEPLOY_MODE" == release ]]; then
  ./scripts/db-tool.sh supabase db push --linked
fi
