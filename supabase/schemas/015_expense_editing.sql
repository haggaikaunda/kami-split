-- #212: only a guarded function can replace the current projection. Every
-- material state remains immutable and addressable by the financial anchor.
SET ROLE kami_migrator;
ALTER TABLE app.expenses ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version>0);
CREATE TABLE app.expense_revisions (LIKE app.expenses INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
 event_id uuid NOT NULL DEFAULT gen_random_uuid(),
 actor_user_id uuid NOT NULL REFERENCES app.users(id),
 actor_membership_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(id,version), UNIQUE(id,version,group_id), UNIQUE(event_id), UNIQUE(group_id,revision),
 FOREIGN KEY(id,group_id) REFERENCES app.expenses(id,group_id) ON DELETE CASCADE,
 FOREIGN KEY(actor_membership_id,group_id) REFERENCES app.memberships(id,group_id),
 FOREIGN KEY(creator_id,group_id) REFERENCES app.memberships(id,group_id),
 FOREIGN KEY(payer_id,group_id) REFERENCES app.memberships(id,group_id)
);
CREATE TABLE app.expense_revision_allocations (
 expense_id uuid NOT NULL, version bigint NOT NULL, group_id uuid NOT NULL,
 participant_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 0 AND 999999999),
 percentage_hundredths integer CHECK(percentage_hundredths BETWEEN 0 AND 10000),
 PRIMARY KEY(expense_id,version,participant_id),
 FOREIGN KEY(expense_id,version,group_id) REFERENCES app.expense_revisions(id,version,group_id) ON DELETE CASCADE,
 FOREIGN KEY(participant_id,group_id) REFERENCES app.memberships(id,group_id)
);
-- A narrowly scoped owner policy is needed by SECURITY DEFINER projection writes.
-- The login role still has no UPDATE or DELETE privilege on any financial table.
CREATE POLICY expense_owner ON app.expenses TO kami_migrator USING(true) WITH CHECK(true);
CREATE POLICY allocation_owner ON app.allocations TO kami_migrator USING(true) WITH CHECK(true);
CREATE POLICY expense_audit_owner ON app.expense_audit FOR SELECT TO kami_migrator USING(true);
CREATE POLICY financial_owner_read ON app.financial_records FOR SELECT TO kami_migrator USING(true);
CREATE POLICY expense_operation_owner ON app.expense_operations FOR SELECT TO kami_migrator USING(true);
ALTER TABLE app.expense_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.expense_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.expense_revision_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.expense_revision_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY revision_read ON app.expense_revisions FOR SELECT TO kami_api USING(app.can_read_group(group_id));
CREATE POLICY revision_owner ON app.expense_revisions TO kami_migrator USING(true) WITH CHECK(true);
CREATE POLICY revision_allocation_read ON app.expense_revision_allocations FOR SELECT TO kami_api USING(app.can_read_group(group_id));
CREATE POLICY revision_allocation_owner ON app.expense_revision_allocations TO kami_migrator USING(true) WITH CHECK(true);
GRANT SELECT ON app.expense_revisions,app.expense_revision_allocations TO kami_api;
INSERT INTO app.expense_revisions SELECT e.*,e.id,a.actor_user_id,a.creator_id,e.created_at
 FROM app.expenses e JOIN app.expense_audit a ON a.expense_id=e.id;
INSERT INTO app.expense_revision_allocations
SELECT a.expense_id, 1, a.group_id, a.participant_id, a.amount_minor, a.percentage_hundredths
FROM app.allocations a;
ALTER TABLE app.expense_operations DROP CONSTRAINT expense_operations_expense_id_key;
CREATE UNIQUE INDEX original_expense_operation ON app.expense_operations(expense_id) WHERE operation_kind='CREATE_EXPENSE';
ALTER TABLE app.expense_operations DROP CONSTRAINT financial_operation_kind;
ALTER TABLE app.expense_operations ADD CONSTRAINT financial_operation_kind CHECK(
 (operation_kind='CREATE_EXPENSE' AND canonical_version IN ('create-expense-v1','create-expense-percentage-v2') AND repayment_id IS NULL)
 OR (operation_kind='EDIT_EXPENSE' AND canonical_version='edit-expense-v1' AND repayment_id IS NULL)
 OR (operation_kind='RECORD_REPAYMENT' AND canonical_version='record-repayment-v1' AND expense_id IS NULL));
ALTER TABLE app.expense_operations DROP CONSTRAINT financial_operation_outcome;
ALTER TABLE app.expense_operations ADD CONSTRAINT financial_operation_outcome CHECK(coalesce(
 (outcome->>'Kind'='COMMITTED' AND (
  (operation_kind IN ('CREATE_EXPENSE','EDIT_EXPENSE') AND expense_id IS NOT NULL AND outcome->'Record'->>'ExpenseID'='ks1:Expense:'||expense_id::text)
  OR (operation_kind='RECORD_REPAYMENT' AND repayment_id IS NOT NULL AND outcome->'Repayment'->>'RepaymentID'='ks1:Repayment:'||repayment_id::text)))
 OR (outcome->>'Kind' IN ('VALIDATION','CONFLICT','LOCKED') AND expense_id IS NULL AND repayment_id IS NULL),false));
ALTER TABLE app.financial_records DROP CONSTRAINT financial_records_kind_check;
ALTER TABLE app.financial_records ADD CONSTRAINT financial_records_kind_check CHECK(kind IN ('CREATE_EXPENSE','EDIT_EXPENSE','RECORD_REPAYMENT'));

CREATE FUNCTION app.expenses_at_revision(target uuid, anchor bigint) RETURNS SETOF app.expenses
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT DISTINCT ON(r.id) r.id,r.group_id,r.creator_id,r.payer_id,r.total_minor,r.currency,r.description,
 r.effective_date,r.category,r.note,r.split,r.created_at,r.creation_tx,r.revision,r.version
 FROM app.expense_revisions r WHERE r.group_id=target AND r.revision<=anchor ORDER BY r.id,r.version DESC;
$$;
CREATE FUNCTION app.allocations_at_revision(target uuid, target_version bigint) RETURNS SETOF app.allocations
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT a.expense_id,a.group_id,a.participant_id,a.amount_minor,a.percentage_hundredths
 FROM app.expense_revision_allocations a WHERE a.expense_id=target AND a.version=target_version;
$$;
GRANT EXECUTE ON FUNCTION app.expenses_at_revision(uuid,bigint),app.allocations_at_revision(uuid,bigint) TO kami_api;

-- Lock every source-ledger user in order before the group. This deliberately
-- coarse scope includes old and new affected users even when another edit changes
-- the saved set while the caller waits, without taking user locks after the group.
CREATE FUNCTION app.lock_expense_edit(target_group uuid, target_expense uuid, proposed_members uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; locked_users uuid[];
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000'; END IF;
 SELECT id INTO actor FROM app.users WHERE auth_subject=app.verified_subject() AND live_auth_id=auth_subject AND enabled;
 IF actor IS NULL THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 SELECT array_agg(locked.id) INTO locked_users FROM (SELECT u.id FROM app.users u WHERE u.id=actor OR u.id IN(SELECT m.user_id FROM app.memberships m WHERE m.group_id=target_group OR m.id=ANY(proposed_members))
 ORDER BY u.id FOR SHARE) locked;
 PERFORM id FROM app.groups WHERE id=target_group FOR UPDATE;
 IF EXISTS(SELECT FROM app.memberships m WHERE m.group_id=target_group AND NOT(m.user_id=ANY(locked_users))) THEN
  RAISE EXCEPTION 'group membership changed while acquiring locks' USING ERRCODE='40001';
 END IF;
 IF NOT app.can_read_group(target_group) OR NOT EXISTS(SELECT FROM app.expenses WHERE id=target_expense AND group_id=target_group)
 THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION app.lock_expense_edit(uuid,uuid,uuid[]) TO kami_api;

CREATE FUNCTION app.apply_expense_edit(target uuid, expected_version bigint, new_payer uuid,new_total bigint,
 new_description text,new_date date,new_category text,new_note text,new_split text,new_shares jsonb,new_revision bigint)
RETURNS TABLE(version bigint,event_id uuid,event_time timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE e app.expenses; next_event uuid:=gen_random_uuid(); at_time timestamptz:=clock_timestamp(); actor uuid; actor_member uuid;
BEGIN
 SELECT * INTO e FROM app.expenses WHERE id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 PERFORM app.lock_expense_edit(e.group_id,target,ARRAY[new_payer]);
 SELECT * INTO STRICT e FROM app.expenses WHERE id=target;
 IF expected_version IS NULL OR e.version<>expected_version THEN RAISE EXCEPTION 'expense version conflict' USING ERRCODE='40001'; END IF;
 -- Inspect the saved involvement before considering its replacement, including zero shares.
 IF EXISTS(SELECT FROM app.memberships m WHERE m.group_id=e.group_id AND
 (m.id=e.payer_id OR m.id IN(SELECT participant_id FROM app.allocations WHERE expense_id=target)) AND NOT m.active)
 THEN RAISE EXCEPTION 'former member expense lock' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT FROM app.memberships m JOIN app.users u ON u.id=m.user_id WHERE m.group_id=e.group_id AND
 (m.id=e.payer_id OR m.id IN(SELECT participant_id FROM app.allocations WHERE expense_id=target)) AND (NOT u.enabled OR u.live_auth_id IS DISTINCT FROM u.auth_subject))
 THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(new_shares)<>'array' OR jsonb_array_length(new_shares)=0 THEN RAISE EXCEPTION 'invalid allocation' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT FROM (SELECT new_payer AS id UNION SELECT (s->>'participant_id')::uuid FROM jsonb_array_elements(new_shares) s) p
 WHERE NOT EXISTS(SELECT FROM app.memberships m JOIN app.users u ON u.id=m.user_id WHERE m.id=p.id AND m.group_id=e.group_id AND m.active AND u.enabled AND u.live_auth_id=u.auth_subject))
 THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 IF (e.payer_id,e.total_minor,e.description,e.effective_date,e.category,e.note,e.split) IS NOT DISTINCT FROM
 (new_payer,new_total,new_description,new_date,new_category,new_note,new_split)
 AND (SELECT jsonb_agg(jsonb_build_array(a.participant_id,a.amount_minor,a.percentage_hundredths) ORDER BY a.participant_id) FROM app.allocations a WHERE a.expense_id=target)
 = (SELECT jsonb_agg(jsonb_build_array((s->>'participant_id')::uuid,(s->>'amount_minor')::bigint,(s->>'percentage_hundredths')::integer) ORDER BY (s->>'participant_id')::uuid) FROM jsonb_array_elements(new_shares) s)
 THEN RETURN QUERY SELECT e.version,NULL::uuid,NULL::timestamptz; RETURN; END IF;
 IF new_revision IS NULL OR new_revision<=(SELECT coalesce(max(f.revision),0) FROM app.financial_records f WHERE f.group_id=e.group_id) THEN RAISE EXCEPTION 'invalid financial revision' USING ERRCODE='23514'; END IF;
 at_time:=clock_timestamp();
 SELECT id INTO actor FROM app.viewer_identity(); actor_member:=app.viewer_membership(e.group_id);
 UPDATE app.expenses SET payer_id=new_payer,total_minor=new_total,description=new_description,effective_date=new_date,
 category=new_category,note=new_note,split=new_split,revision=new_revision,version=e.version+1 WHERE id=target;
 DELETE FROM app.allocations WHERE expense_id=target;
 INSERT INTO app.allocations(expense_id,group_id,participant_id,amount_minor,percentage_hundredths)
 SELECT target,e.group_id,(s->>'participant_id')::uuid,(s->>'amount_minor')::bigint,(s->>'percentage_hundredths')::integer FROM jsonb_array_elements(new_shares) s;
 INSERT INTO app.expense_revisions SELECT x.*,next_event,actor,actor_member,at_time FROM app.expenses x WHERE x.id=target;
 INSERT INTO app.expense_revision_allocations SELECT a.expense_id,e.version+1,a.group_id,a.participant_id,a.amount_minor,a.percentage_hundredths FROM app.allocations a WHERE a.expense_id=target;
 INSERT INTO app.financial_records(group_id,revision,kind,record_id) VALUES(e.group_id,new_revision,'EDIT_EXPENSE',next_event);
 RETURN QUERY SELECT e.version+1,next_event,at_time;
END $$;
GRANT EXECUTE ON FUNCTION app.apply_expense_edit(uuid,bigint,uuid,bigint,text,date,text,text,text,jsonb,bigint) TO kami_api;

-- Creation retains its original atomicity rules and additionally captures version
-- one. Existing receipts are never rewritten by edits or by this migration.
CREATE OR REPLACE FUNCTION app.check_expense_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE target uuid; e app.expenses; n bigint; owed numeric;
BEGIN
 IF TG_TABLE_NAME='expenses' THEN target:=NEW.id; ELSE target:=NEW.expense_id; END IF;
 IF target IS NULL THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='expense_operations' THEN
  IF NEW.operation_kind='EDIT_EXPENSE' AND coalesce((NEW.outcome->>'Changed')::boolean,false)=false THEN RETURN NULL; END IF;
 END IF;
 SELECT * INTO STRICT e FROM app.expenses WHERE id=target;
 SELECT count(*),sum(amount_minor) INTO n,owed FROM app.allocations WHERE expense_id=target;
 IF n=0 OR owed<>e.total_minor THEN RAISE EXCEPTION 'incomplete expense' USING ERRCODE='23514'; END IF;
 IF e.version=1 THEN
  IF e.creation_tx<>pg_current_xact_id() OR NOT EXISTS(SELECT FROM app.expense_audit a WHERE a.expense_id=e.id AND a.group_id=e.group_id AND a.creator_id=e.creator_id AND a.committed_at=e.created_at)
  OR NOT EXISTS(SELECT FROM app.expense_operations o JOIN app.expense_audit a ON a.expense_id=o.expense_id WHERE o.expense_id=e.id AND o.group_id=e.group_id AND o.actor_user_id=a.actor_user_id AND o.operation_kind='CREATE_EXPENSE')
  THEN RAISE EXCEPTION 'incomplete expense' USING ERRCODE='23514'; END IF;
  INSERT INTO app.expense_revisions SELECT x.*,x.id,a.actor_user_id,a.creator_id,x.created_at FROM app.expenses x JOIN app.expense_audit a ON a.expense_id=x.id WHERE x.id=target ON CONFLICT(id,version) DO NOTHING;
  INSERT INTO app.expense_revision_allocations SELECT a.expense_id,e.version,a.group_id,a.participant_id,a.amount_minor,a.percentage_hundredths FROM app.allocations a WHERE a.expense_id=target ON CONFLICT(expense_id,version,participant_id) DO NOTHING;
 ELSE
  IF NOT EXISTS(SELECT FROM app.expense_revisions r WHERE r.id=e.id AND r.version=e.version AND r.revision=e.revision)
  OR EXISTS((SELECT participant_id,amount_minor,percentage_hundredths FROM app.allocations WHERE expense_id=target EXCEPT SELECT participant_id,amount_minor,percentage_hundredths FROM app.expense_revision_allocations WHERE expense_id=target AND version=e.version)
   UNION ALL (SELECT participant_id,amount_minor,percentage_hundredths FROM app.expense_revision_allocations WHERE expense_id=target AND version=e.version EXCEPT SELECT participant_id,amount_minor,percentage_hundredths FROM app.allocations WHERE expense_id=target))
  THEN RAISE EXCEPTION 'incomplete expense revision' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;

-- Validate each immutable version, not just the final projection, so multiple
-- attempted writes in one transaction cannot omit intermediate provenance.
CREATE FUNCTION app.check_expense_revision_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE n bigint; owed numeric; percentage_count bigint; percentage_sum numeric; intended jsonb; resolved jsonb; snapshot jsonb;
BEGIN
 SELECT count(*),sum(amount_minor),count(percentage_hundredths),sum(percentage_hundredths),
 jsonb_agg(jsonb_build_object('ParticipantID','ks1:Membership:'||participant_id::text,'Amount',amount_minor) ORDER BY participant_id),
 jsonb_agg(jsonb_build_object('ParticipantID','ks1:Membership:'||participant_id::text,'Hundredths',percentage_hundredths) ORDER BY participant_id)
 INTO n,owed,percentage_count,percentage_sum,resolved,intended
 FROM app.expense_revision_allocations WHERE expense_id=NEW.id AND version=NEW.version;
 IF n=0 OR owed<>NEW.total_minor OR (NEW.split<>'PERCENTAGE' AND percentage_count<>0)
 OR (NEW.split='PERCENTAGE' AND (percentage_count<>n OR percentage_sum<>10000))
 THEN RAISE EXCEPTION 'incomplete expense revision allocation' USING ERRCODE='23514'; END IF;
 IF NEW.split='EQUAL' AND NEW.version>1 AND EXISTS(SELECT FROM (SELECT amount_minor,row_number() OVER(ORDER BY participant_id) AS rank FROM app.expense_revision_allocations WHERE expense_id=NEW.id AND version=NEW.version) shares WHERE amount_minor<>NEW.total_minor/n+CASE WHEN rank<=mod(NEW.total_minor,n) THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'incorrect equal allocation' USING ERRCODE='23514'; END IF;
 IF NEW.split='PERCENTAGE' AND EXISTS(WITH shares AS (
 SELECT participant_id,amount_minor,percentage_hundredths,floor(NEW.total_minor::numeric*percentage_hundredths/10000) AS base,
 mod(NEW.total_minor::numeric*percentage_hundredths,10000) AS remainder FROM app.expense_revision_allocations WHERE expense_id=NEW.id AND version=NEW.version
 ), ranked AS (SELECT *,row_number() OVER(ORDER BY remainder DESC,participant_id) AS rank,NEW.total_minor-sum(base) OVER() AS remaining FROM shares)
 SELECT FROM ranked WHERE amount_minor<>base+CASE WHEN rank<=remaining AND percentage_hundredths>0 THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'incorrect percentage allocation' USING ERRCODE='23514'; END IF;
 IF NEW.version>1 THEN
  snapshot:=jsonb_build_object('ExpenseID','ks1:Expense:'||NEW.id::text,'GroupID','ks1:Group:'||NEW.group_id::text,
   'CreatorMembershipID','ks1:Membership:'||NEW.creator_id::text,'PayerMembershipID','ks1:Membership:'||NEW.payer_id::text,
   'TotalMinor',NEW.total_minor,'Currency',NEW.currency,'Description',NEW.description,'EffectiveDate',to_char(NEW.effective_date,'YYYY-MM-DD'),
   'Category',NEW.category,'Note',NEW.note,'Split',NEW.split,'Revision',NEW.revision,'Version',NEW.version,'Allocations',resolved,
   'CommittedAt',to_char(NEW.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  IF NOT EXISTS(SELECT FROM app.expense_revisions p WHERE p.id=NEW.id AND p.version=NEW.version-1 AND p.group_id=NEW.group_id AND p.creator_id=NEW.creator_id AND p.created_at=NEW.created_at AND p.currency=NEW.currency AND p.revision<NEW.revision)
  OR NOT EXISTS(SELECT FROM app.financial_records f WHERE f.group_id=NEW.group_id AND f.revision=NEW.revision AND f.kind='EDIT_EXPENSE' AND f.record_id=NEW.event_id)
  OR NOT EXISTS(SELECT FROM app.expense_operations o WHERE o.expense_id=NEW.id AND o.group_id=NEW.group_id AND o.operation_kind='EDIT_EXPENSE'
   AND o.actor_user_id=NEW.actor_user_id AND o.outcome->>'Kind'='COMMITTED' AND o.outcome->>'Changed'='true'
   AND o.outcome->'Record' @> snapshot AND o.outcome->'Record'->'Allocations'=resolved AND (NEW.split<>'PERCENTAGE' OR o.outcome->'Record'->'Percentages'=intended))
  THEN RAISE EXCEPTION 'incomplete expense revision provenance' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER expense_revision_complete AFTER INSERT ON app.expense_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_expense_revision_complete();

-- The creation-only percentage receipt check remains authoritative for version
-- one. Material edits are checked against their own immutable revision above.
CREATE OR REPLACE FUNCTION app.check_percentage_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE target uuid; e app.expenses; n bigint; percentage_count bigint; percentage_sum numeric; intended jsonb; resolved jsonb;
BEGIN
 IF TG_TABLE_NAME='expenses' THEN target:=NEW.id; ELSE target:=NEW.expense_id; END IF;
 IF target IS NULL THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='expense_operations' THEN
  IF NEW.operation_kind='EDIT_EXPENSE' THEN RETURN NULL; END IF;
 END IF;
 SELECT * INTO STRICT e FROM app.expenses WHERE id=target;
 IF e.version>1 THEN RETURN NULL; END IF;
 SELECT count(*),count(percentage_hundredths),sum(percentage_hundredths) INTO n,percentage_count,percentage_sum FROM app.allocations WHERE expense_id=target;
 IF e.split<>'PERCENTAGE' THEN
  IF percentage_count<>0 THEN RAISE EXCEPTION 'unexpected percentage intent' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF n=0 OR percentage_count<>n OR percentage_sum<>10000 THEN RAISE EXCEPTION 'incomplete percentage intent' USING ERRCODE='23514'; END IF;
 IF EXISTS(WITH shares AS (
  SELECT participant_id,amount_minor,percentage_hundredths,floor(e.total_minor::numeric*percentage_hundredths/10000) AS base,
   mod(e.total_minor::numeric*percentage_hundredths,10000) AS remainder FROM app.allocations WHERE expense_id=target
 ), ranked AS (SELECT *,row_number() OVER(ORDER BY remainder DESC,participant_id ASC) AS rank,e.total_minor-sum(base) OVER() AS remaining FROM shares)
 SELECT FROM ranked WHERE amount_minor<>base+CASE WHEN rank<=remaining AND percentage_hundredths>0 THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'incorrect percentage allocation' USING ERRCODE='23514'; END IF;
 SELECT jsonb_agg(jsonb_build_object('ParticipantID','ks1:Membership:'||participant_id::text,'Hundredths',percentage_hundredths) ORDER BY participant_id),
 jsonb_agg(jsonb_build_object('ParticipantID','ks1:Membership:'||participant_id::text,'Amount',amount_minor) ORDER BY participant_id)
 INTO intended,resolved FROM app.allocations WHERE expense_id=target;
 IF NOT EXISTS(SELECT FROM app.expense_operations o WHERE o.expense_id=target AND o.canonical_version='create-expense-percentage-v2'
  AND o.outcome->'Record'->>'Split'='PERCENTAGE' AND o.outcome->'Record'->'Percentages'=intended AND o.outcome->'Record'->'Allocations'=resolved)
 THEN RAISE EXCEPTION 'incomplete percentage outcome' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
-- Lifecycle callers acquire user and group locks before changing a membership.
-- A raw administrative UPDATE already owns the member tuple, so NOWAIT prevents
-- reversing that order against a writer taking its allocation foreign-key lock.
-- Contention rejects the whole transition for retry; it never permits a stale net.
CREATE POLICY repayment_owner_read ON app.repayments FOR SELECT TO kami_migrator USING(true);
CREATE FUNCTION app.enforce_zero_net_departure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE net numeric;
BEGIN
 IF NOT OLD.active OR NEW.active THEN RETURN NEW; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000'; END IF;
 PERFORM id FROM app.users WHERE id=OLD.user_id FOR SHARE NOWAIT;
 PERFORM id FROM app.groups WHERE id=OLD.group_id FOR UPDATE NOWAIT;
 SELECT coalesce((SELECT sum(total_minor::numeric) FROM app.expenses WHERE group_id=OLD.group_id AND payer_id=OLD.id),0)
  -coalesce((SELECT sum(amount_minor::numeric) FROM app.allocations WHERE group_id=OLD.group_id AND participant_id=OLD.id),0)
  +coalesce((SELECT sum(amount_minor::numeric) FROM app.repayments WHERE group_id=OLD.group_id AND sender_id=OLD.id),0)
  -coalesce((SELECT sum(amount_minor::numeric) FROM app.repayments WHERE group_id=OLD.group_id AND recipient_id=OLD.id),0) INTO net;
 IF net<>0 THEN RAISE EXCEPTION 'membership has a nonzero balance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_financial_membership_departure BEFORE UPDATE OF active ON app.memberships
FOR EACH ROW EXECUTE FUNCTION app.enforce_zero_net_departure();

RESET ROLE;
