DO $$ DECLARE before public.banking_background_snapshot; BEGIN
 SELECT * INTO STRICT before FROM public.banking_background_snapshot;
 IF before.users IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM app.users u)
 OR before.groups IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM app.groups g)
 OR before.expenses IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM app.expenses e)
 OR before.sources IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM app.banking_sources s)
 OR before.revisions IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(r)-'provider_primary_category' ORDER BY source_id,revision) FROM app.banking_source_revisions r)
 OR before.preferences IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY owner_id) FROM app.reporting_timezones p)
 OR before.work_count<>(SELECT count(*) FROM app.banking_work) THEN
   RAISE EXCEPTION 'recovery changed retained financial/private history or duplicated work';
 END IF;
 IF EXISTS(SELECT FROM app.banking_source_revisions WHERE provider_primary_category IS NOT NULL) THEN
   RAISE EXCEPTION 'retained revisions fabricated provider taxonomy';
 END IF;
 IF EXISTS(SELECT FROM app.banking_work WHERE requested_version<>1 OR claimed_version<>1
   OR completed_version<>CASE WHEN state='complete' THEN 1 ELSE 0 END) THEN
   RAISE EXCEPTION 'existing work versions were not safely backfilled';
 END IF;
 IF has_function_privilege('kami_api','app.banking_sync_dispatch(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','app.banking_sync_dispatch(uuid)','EXECUTE')
 OR has_table_privilege('authenticated','app.banking_work','SELECT')
 OR has_table_privilege('kami_api','app.banking_work','SELECT') THEN
   RAISE EXCEPTION 'recovery widened private work permissions';
 END IF;
END $$;
-- Existing status callers remain compatible before application promotion, with
-- owner checks and direct private-work access still enforced by PostgreSQL.
BEGIN;
SET LOCAL ROLE kami_api;
SELECT set_config('app.verified_sub','b3290000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF app.banking_connection_status('b3290000-0000-4000-8000-000000000011') IS NULL THEN
  RAISE EXCEPTION 'owner lost status access'; END IF;
END $$;
RESET ROLE;
SELECT set_config('app.verified_sub',(SELECT auth_subject::text FROM app.users
 WHERE id<>'b3290000-0000-4000-8000-000000000001' AND enabled
 AND live_auth_id=auth_subject ORDER BY id LIMIT 1),true);
DO $$ BEGIN
 IF coalesce(current_setting('app.verified_sub',true),'')='' THEN
  RAISE EXCEPTION 'cross-owner denial requires another live fixture user';
 END IF;
END $$;
SET LOCAL ROLE kami_api;
DO $$ BEGIN
 IF app.banking_connection_status('b3290000-0000-4000-8000-000000000011') IS NOT NULL THEN
  RAISE EXCEPTION 'cross-owner status disclosed'; END IF;
 BEGIN
  PERFORM * FROM app.banking_work;
  RAISE EXCEPTION 'runtime unexpectedly read private work';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
