-- Actual deployed release history, including the higher status migration.
DO $$ BEGIN
 IF (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261022010000'
   OR EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261022000000')
   OR EXISTS(SELECT FROM information_schema.columns WHERE table_schema='app' AND table_name='banking_work' AND column_name='requested_version') THEN
   RAISE EXCEPTION 'background upgrade requires deployed status history without background sync';
 END IF;
END $$;
SET ROLE kami_migrator;
-- Existing initial work has both pending and completed behavior to backfill.
SELECT app.banking_initial_enqueue('b3290000-0000-4000-8000-000000000011');
UPDATE app.banking_work SET state='complete' WHERE kind='initial_sync' AND connection_id='b3290000-0000-4000-8000-000000000011';
RESET ROLE;
CREATE TABLE public.banking_background_snapshot AS SELECT
 (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM app.users u) AS users,
 (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM app.groups g) AS groups,
 (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM app.expenses e) AS expenses,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM app.banking_sources s) AS sources,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY source_id,revision) FROM app.banking_source_revisions r) AS revisions,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY owner_id) FROM app.reporting_timezones p) AS preferences,
 (SELECT count(*) FROM app.banking_work) AS work_count;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.banking_background_snapshot WHERE jsonb_array_length(users)>0
  AND jsonb_array_length(expenses)>0 AND jsonb_array_length(sources)>0 AND work_count>0) THEN
  RAISE EXCEPTION 'background upgrade requires representative nonempty fixtures';
 END IF;
END $$;
