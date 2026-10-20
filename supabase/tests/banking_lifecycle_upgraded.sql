DO $$ BEGIN
 IF (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261020030000'
   OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261020030000')<>1
   OR NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261020020000') THEN
   RAISE EXCEPTION 'normal push failed to register lifecycle after deployed timezone';
 END IF;
 IF EXISTS(
   (SELECT * FROM public.banking_lifecycle_upgrade_snapshot EXCEPT SELECT * FROM public.banking_lifecycle_upgrade_observation)
   UNION ALL
   (SELECT * FROM public.banking_lifecycle_upgrade_observation EXCEPT SELECT * FROM public.banking_lifecycle_upgrade_snapshot)) THEN
   RAISE EXCEPTION 'lifecycle upgrade changed timezone receipts or banking history';
 END IF;
 IF NOT EXISTS(SELECT FROM app.banking_enrollment_removals
   WHERE attempt_id='b3320000-0000-4000-8000-000000000010'
     AND item_digest=sha256(convert_to('b3320000-0000-4000-8000-000000000010/sandbox/confirmed-upgrade-secondary','UTF8'))) THEN
   RAISE EXCEPTION 'available positive removal proof was lost at upgrade';
 END IF;
 IF NOT EXISTS(SELECT FROM app.banking_connections WHERE id='b3290000-0000-4000-8000-000000000011' AND health='repair_required')
   OR to_regclass('app.banking_repairs') IS NULL
   OR to_regprocedure('app.banking_accept_lifecycle_webhook(uuid,text,text,bytea,bytea,text,text,text,boolean)') IS NULL THEN
   RAISE EXCEPTION 'lifecycle upgrade omitted behavior or attention backfill';
 END IF;
END $$;
DROP VIEW public.banking_lifecycle_upgrade_observation;
DROP TABLE public.banking_lifecycle_upgrade_snapshot;
