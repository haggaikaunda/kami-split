-- Synthetic disposable local/CI credential only. Never apply seeds to hosted DBs.
-- No fabricated users/groups/expenses; add synthetic domain seeds with that feature.
ALTER ROLE kami_api PASSWORD 'kami-local-only';
