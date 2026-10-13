DO $$
BEGIN
 IF NOT EXISTS(
   SELECT
   FROM public.expense_editing_upgrade_snapshot
 ) THEN RAISE EXCEPTION 'missing historical expense upgrade fixture';
 END IF;
 IF EXISTS(SELECT FROM public.expense_editing_upgrade_snapshot s JOIN app.expenses e ON e.id=s.id
 WHERE s.expense<>to_jsonb(e)-'version'
 OR s.allocations<>(SELECT jsonb_agg(to_jsonb(a) ORDER BY participant_id) FROM app.allocations a WHERE a.expense_id=e.id)
 OR s.audit<>(SELECT to_jsonb(a) FROM app.expense_audit a WHERE a.expense_id=e.id)
 OR s.operation<>(SELECT to_jsonb(o) FROM app.expense_operations o WHERE o.expense_id=e.id)
 OR NOT EXISTS(
   SELECT
   FROM app.expense_revisions r
   WHERE r.id = e.id
   AND r.version = 1
   AND r.event_id = e.id
   AND r.recorded_at = e.created_at
   AND r.total_minor = e.total_minor
 ))
 THEN RAISE EXCEPTION 'expense edit upgrade changed creation history or omitted revision'; END IF;
 IF has_table_privilege('kami_api', 'app.expenses', 'UPDATE,DELETE')
 OR has_table_privilege('kami_api', 'app.allocations', 'UPDATE,DELETE')
 OR has_table_privilege('kami_api', 'app.expense_revisions', 'INSERT,UPDATE,DELETE')
 OR has_table_privilege('kami_api', 'app.expense_revision_allocations', 'INSERT,UPDATE,DELETE')
 THEN RAISE EXCEPTION 'unrestricted financial history write grant'; END IF;
END $$;
-- Exercise the restricted-role boundary and deferred atomicity, keeping upgrade
-- fixture history intact for subsequent checks and replay.
BEGIN;
SELECT set_config('app.verified_sub','a1100000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE kami_api;
DO $$
DECLARE r record; before_count bigint;
BEGIN
 SELECT count(*) INTO before_count FROM app.expense_revisions WHERE id='a1100000-0000-4000-8000-000000000004';
 SELECT * INTO r
 FROM app.apply_expense_edit(
   'a1100000-0000-4000-8000-000000000004', 1, 'a1100000-0000-4000-8000-000000000003',
   100, 'Existing', '2026-01-01', 'OTHER', '', 'EXACT', '[{"participant_id":"a1100000-0000-4000-8000-000000000003","amount_minor":100}]',
   2
 );
 IF r.version <> 1
 OR r.event_id IS NOT NULL
 OR before_count <>(
   SELECT count(*)
   FROM app.expense_revisions
   WHERE id = 'a1100000-0000-4000-8000-000000000004'
 ) THEN RAISE EXCEPTION 'no-op produced revision';
 END IF;
 BEGIN
  PERFORM app.apply_expense_edit('a1100000-0000-4000-8000-000000000004',NULL,'a1100000-0000-4000-8000-000000000003',80,'Existing','2026-01-01','OTHER','','EXACT','[{"participant_id":"a1100000-0000-4000-8000-000000000003","amount_minor":80}]',2);
  RAISE EXCEPTION 'missing version accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM app.apply_expense_edit('a1100000-0000-4000-8000-000000000004',1,'a1100000-0000-4000-8000-000000000003',80,'Existing','2026-01-01','OTHER','','EXACT','[{"participant_id":"a1100000-0000-4000-8000-000000000003","amount_minor":80}]',1);
  RAISE EXCEPTION 'non-monotonic revision accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM app.apply_expense_edit('a1100000-0000-4000-8000-000000000004',1,'a1100000-0000-4000-8000-000000000003',80,'Existing','2026-01-01','OTHER','','EXACT','[{"participant_id":"a1100000-0000-4000-8000-000000000003","amount_minor":80}]',2);
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'audit-free edit accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF(
   SELECT total_minor
   FROM app.expenses
   WHERE id = 'a1100000-0000-4000-8000-000000000004'
 ) <> 100
 OR (
   SELECT count(*)
   FROM app.expense_revisions
   WHERE id = 'a1100000-0000-4000-8000-000000000004'
 ) <> before_count THEN RAISE EXCEPTION 'failed edit leaked financial state';
 END IF;
END $$;
ROLLBACK;
DROP TABLE public.expense_editing_upgrade_snapshot;
