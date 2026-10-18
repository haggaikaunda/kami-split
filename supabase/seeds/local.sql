-- Synthetic disposable local/CI credential only. Never apply seeds to hosted DBs.
-- No fabricated users/groups/expenses; add synthetic domain seeds with that feature.
ALTER ROLE kami_api PASSWORD 'kami-local-only';
DO $$ BEGIN
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='kami_worker') THEN
    ALTER ROLE kami_worker PASSWORD 'kami-worker-local-only';
  END IF;
END $$;
