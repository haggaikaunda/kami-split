SET ROLE kami_migrator;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM app.banking_account_barriers WHERE account_id='b3290000-0000-4000-8000-000000000020')
    OR NOT EXISTS(SELECT FROM app.banking_deletion_accounts WHERE connection_id='b3290000-0000-4000-8000-000000000010' AND account_id='b3290000-0000-4000-8000-000000000020')
    OR (SELECT count(*) FROM app.banking_work WHERE connection_id='b3290000-0000-4000-8000-000000000010' AND state='pending')<>2
    OR NOT EXISTS(SELECT FROM app.banking_connections WHERE id='b3290000-0000-4000-8000-000000000011' AND state='active') THEN
    RAISE EXCEPTION 'legacy deletion was not durably upgraded';
  END IF;
END $$;
RESET ROLE;
BEGIN;
SELECT set_config('app.verified_sub','b3290000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE kami_api;
DO $$ BEGIN
  IF EXISTS(SELECT FROM app.banking_sources WHERE id='b3290000-0000-4000-8000-000000000040')
    OR NOT EXISTS(SELECT FROM app.banking_sources WHERE id='b3290000-0000-4000-8000-000000000041') THEN
    RAISE EXCEPTION 'legacy account fence exposed history or hid sibling';
  END IF;
END $$;
ROLLBACK;
