-- #110: actual group repayments share durable attempts and financial revisions.
SET ROLE kami_migrator;
CREATE TABLE app.repayments (
 id uuid PRIMARY KEY,
 group_id uuid NOT NULL REFERENCES app.groups(id),
 creator_id uuid NOT NULL,
 sender_id uuid NOT NULL,
 recipient_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 999999999),
 currency text NOT NULL CHECK(currency='USD'),
 effective_date date NOT NULL CHECK(effective_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 note text NOT NULL CHECK(char_length(note)<=2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 creation_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
 revision bigint NOT NULL CHECK(revision>0),
 CHECK(sender_id<>recipient_id),
 UNIQUE(id,group_id), UNIQUE(group_id,revision),
 FOREIGN KEY(creator_id,group_id) REFERENCES app.memberships(id,group_id),
 FOREIGN KEY(sender_id,group_id) REFERENCES app.memberships(id,group_id),
 FOREIGN KEY(recipient_id,group_id) REFERENCES app.memberships(id,group_id)
);
CREATE INDEX repayment_page ON app.repayments(group_id,effective_date DESC,created_at DESC,id DESC);
CREATE TABLE app.repayment_audit (
 repayment_id uuid PRIMARY KEY,
 group_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES app.users(id),
 creator_id uuid NOT NULL,
 event text NOT NULL CHECK(event='RECORD_REPAYMENT'),
 committed_at timestamptz NOT NULL,
 FOREIGN KEY(repayment_id,group_id) REFERENCES app.repayments(id,group_id),
 FOREIGN KEY(creator_id,group_id) REFERENCES app.memberships(id,group_id)
);
-- Keep the deployed table name and original expense bytes/outcomes intact.
ALTER TABLE app.expense_operations DROP CONSTRAINT expense_operations_operation_kind_check;
ALTER TABLE app.expense_operations DROP CONSTRAINT expense_operations_canonical_version_check;
ALTER TABLE app.expense_operations ADD COLUMN repayment_id uuid UNIQUE;
ALTER TABLE app.expense_operations ADD FOREIGN KEY(repayment_id,group_id) REFERENCES app.repayments(id,group_id);
ALTER TABLE app.expense_operations ADD CONSTRAINT financial_operation_kind CHECK(
 (operation_kind='CREATE_EXPENSE' AND canonical_version='create-expense-v1' AND repayment_id IS NULL)
 OR (operation_kind='RECORD_REPAYMENT' AND canonical_version='record-repayment-v1' AND expense_id IS NULL));
ALTER TABLE app.expense_operations ADD CONSTRAINT financial_operation_outcome CHECK(
 coalesce((outcome->>'Kind'='COMMITTED' AND
  ((operation_kind='CREATE_EXPENSE' AND expense_id IS NOT NULL AND outcome->'Record'->>'ExpenseID'='ks1:Expense:'||expense_id::text)
   OR (operation_kind='RECORD_REPAYMENT' AND repayment_id IS NOT NULL AND outcome->'Repayment'->>'RepaymentID'='ks1:Repayment:'||repayment_id::text)))
 OR (outcome->>'Kind'='VALIDATION' AND expense_id IS NULL AND repayment_id IS NULL),false));
CREATE TABLE app.financial_records (
 group_id uuid NOT NULL REFERENCES app.groups(id),
 revision bigint NOT NULL CHECK(revision>0),
 kind text NOT NULL CHECK(kind IN ('CREATE_EXPENSE','RECORD_REPAYMENT')),
 record_id uuid NOT NULL,
 PRIMARY KEY(group_id,revision), UNIQUE(kind,record_id)
);
-- Migration owner sees all shipped history only within this DDL transaction.
ALTER TABLE app.expenses NO FORCE ROW LEVEL SECURITY;
INSERT INTO app.financial_records SELECT group_id,revision,'CREATE_EXPENSE',id FROM app.expenses;
ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY;
ALTER TABLE app.financial_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.financial_records FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_read ON app.financial_records FOR SELECT TO kami_api USING(app.can_read_group(group_id));
CREATE POLICY financial_register ON app.financial_records FOR INSERT TO kami_migrator WITH CHECK(true);
GRANT SELECT ON app.financial_records TO kami_api;
CREATE FUNCTION app.register_financial_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 INSERT INTO app.financial_records(group_id,revision,kind,record_id)
 VALUES(NEW.group_id,NEW.revision,CASE TG_TABLE_NAME WHEN 'expenses' THEN 'CREATE_EXPENSE' ELSE 'RECORD_REPAYMENT' END,NEW.id);
 RETURN NULL;
END $$;
CREATE TRIGGER register_expense AFTER INSERT ON app.expenses FOR EACH ROW EXECUTE FUNCTION app.register_financial_record();
CREATE TRIGGER register_repayment AFTER INSERT ON app.repayments FOR EACH ROW EXECUTE FUNCTION app.register_financial_record();
ALTER TABLE app.repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.repayments FORCE ROW LEVEL SECURITY;
ALTER TABLE app.repayment_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.repayment_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY repayment_read ON app.repayments FOR SELECT TO kami_api USING(app.can_read_group(group_id));
CREATE POLICY repayment_insert ON app.repayments FOR INSERT TO kami_api WITH CHECK (app.can_read_group(group_id) AND creator_id = app.viewer_membership(group_id));
CREATE POLICY repayment_audit_read ON app.repayment_audit FOR SELECT TO kami_api USING(app.can_read_group(group_id));
CREATE POLICY repayment_audit_insert ON app.repayment_audit FOR INSERT TO kami_api WITH CHECK(
  app.can_read_group(group_id)
  AND creator_id = app.viewer_membership(group_id)
  AND actor_user_id =(
    SELECT id
    FROM app.viewer_identity()
  )
);
GRANT SELECT,INSERT ON app.repayments,app.repayment_audit TO kami_api;
CREATE FUNCTION app.check_repayment_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE target uuid; r app.repayments;
BEGIN
 IF TG_TABLE_NAME='repayments' THEN target:=NEW.id; ELSE target:=NEW.repayment_id; END IF;
 IF target IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO STRICT r FROM app.repayments WHERE id=target;
 IF r.creation_tx<>pg_current_xact_id()
 OR NOT EXISTS(
   SELECT
   FROM app.financial_records f
   WHERE f.group_id = r.group_id
   AND f.revision = r.revision
   AND f.kind = 'RECORD_REPAYMENT'
   AND f.record_id = r.id
 )
 OR NOT EXISTS(SELECT FROM app.repayment_audit a JOIN app.expense_operations o ON o.repayment_id=a.repayment_id
 WHERE a.repayment_id=r.id AND a.group_id=r.group_id AND a.creator_id=r.creator_id AND a.committed_at=r.created_at
 AND o.group_id=r.group_id AND o.actor_user_id=a.actor_user_id AND o.operation_kind='RECORD_REPAYMENT'
 AND o.outcome->>'Kind'='COMMITTED' AND o.outcome->'Repayment' @> jsonb_build_object(
 'RepaymentID','ks1:Repayment:'||r.id::text,'GroupID','ks1:Group:'||r.group_id::text,
 'CreatorMembershipID','ks1:Membership:'||r.creator_id::text,'SenderMembershipID','ks1:Membership:'||r.sender_id::text,
 'RecipientMembershipID','ks1:Membership:'||r.recipient_id::text,'AmountMinor',r.amount_minor,'Currency',r.currency,
 'EffectiveDate',to_char(r.effective_date,'YYYY-MM-DD'),'Note',r.note,'Revision',r.revision,
 'CommittedAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
 THEN RAISE EXCEPTION 'incomplete repayment' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER repayment_complete AFTER INSERT ON app.repayments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_repayment_complete();
CREATE CONSTRAINT TRIGGER repayment_audit_complete AFTER INSERT ON app.repayment_audit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_repayment_complete();
CREATE CONSTRAINT TRIGGER repayment_operation_complete AFTER INSERT ON app.expense_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_repayment_complete();
RESET ROLE;
