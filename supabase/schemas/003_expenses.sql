-- #82: append-only expense history and durable operation outcomes. Runtime
-- INSERTs remain subject to RLS, composite keys and deferred reconciliation.
SET ROLE kami_migrator;
CREATE FUNCTION app.viewer_membership(target uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT m.id FROM app.memberships m JOIN app.users u ON u.id=m.user_id
 WHERE m.group_id=target AND m.active AND u.enabled
 AND u.auth_subject=app.verified_subject() AND u.live_auth_id=u.auth_subject;
$$;
GRANT EXECUTE ON FUNCTION app.viewer_membership(uuid) TO kami_api;
CREATE TABLE app.expenses (
 id uuid PRIMARY KEY,
 group_id uuid NOT NULL REFERENCES app.groups(id),
 creator_id uuid NOT NULL,
 payer_id uuid NOT NULL,
 total_minor bigint NOT NULL CHECK(total_minor BETWEEN 1 AND 999999999),
 currency text NOT NULL CHECK(currency='USD'),
 description text NOT NULL CHECK(char_length(description) BETWEEN 1 AND 120 AND description=btrim(description, E' \t\r\n')),
 effective_date date NOT NULL CHECK(effective_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 category text NOT NULL CHECK(category IN ('DINING','GROCERIES','ACCOMMODATION','TRANSPORT','ACTIVITIES','HOME','OTHER')),
 note text NOT NULL CHECK(char_length(note)<=2000),
 split text NOT NULL CHECK(split IN ('EQUAL','EXACT')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 creation_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
 revision bigint NOT NULL CHECK(revision>0),
 UNIQUE(id,group_id), UNIQUE(group_id,revision),
 FOREIGN KEY(creator_id,group_id) REFERENCES app.memberships(id,group_id),
 FOREIGN KEY(payer_id,group_id) REFERENCES app.memberships(id,group_id)
);
CREATE INDEX expense_page ON app.expenses(group_id,effective_date DESC,created_at DESC,id DESC);
CREATE TABLE app.allocations (
 expense_id uuid NOT NULL,
 group_id uuid NOT NULL,
 participant_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 0 AND 999999999),
 PRIMARY KEY(expense_id,participant_id),
 FOREIGN KEY(expense_id,group_id) REFERENCES app.expenses(id,group_id),
 FOREIGN KEY(participant_id,group_id) REFERENCES app.memberships(id,group_id)
);
CREATE INDEX allocation_participant ON app.allocations(group_id,participant_id,expense_id);
CREATE TABLE app.expense_audit (
 expense_id uuid PRIMARY KEY,
 group_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES app.users(id),
 creator_id uuid NOT NULL,
 event text NOT NULL CHECK(event='CREATE_EXPENSE'),
 committed_at timestamptz NOT NULL,
 FOREIGN KEY(expense_id,group_id) REFERENCES app.expenses(id,group_id),
 FOREIGN KEY(creator_id,group_id) REFERENCES app.memberships(id,group_id)
);
CREATE TABLE app.expense_operations (
 actor_user_id uuid NOT NULL REFERENCES app.users(id),
 group_id uuid NOT NULL REFERENCES app.groups(id),
 operation_kind text NOT NULL CHECK(operation_kind='CREATE_EXPENSE'),
 key uuid NOT NULL,
 canonical_version text NOT NULL CHECK(canonical_version='create-expense-v1'),
 canonical bytea NOT NULL,
 canonical_hash bytea NOT NULL CHECK(octet_length(canonical_hash)=32),
 expense_id uuid UNIQUE,
 outcome jsonb NOT NULL CHECK(jsonb_typeof(outcome)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_user_id,group_id,operation_kind,key),
 FOREIGN KEY(expense_id,group_id) REFERENCES app.expenses(id,group_id)
);
ALTER TABLE app.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.expenses FORCE ROW LEVEL SECURITY;
ALTER TABLE app.allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE app.expense_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.expense_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE app.expense_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.expense_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_read ON app.expenses FOR SELECT TO kami_api USING(app.can_read_group(group_id));
CREATE POLICY expense_insert ON app.expenses FOR INSERT TO kami_api WITH CHECK(app.can_read_group(group_id) AND creator_id=app.viewer_membership(group_id));
CREATE POLICY allocation_read ON app.allocations FOR SELECT TO kami_api USING(app.can_read_group(group_id));
CREATE POLICY allocation_insert ON app.allocations FOR INSERT TO kami_api WITH CHECK(app.can_read_group(group_id));
CREATE POLICY audit_read ON app.expense_audit FOR SELECT TO kami_api USING(app.can_read_group(group_id));
CREATE POLICY audit_insert ON app.expense_audit FOR INSERT TO kami_api WITH CHECK(app.can_read_group(group_id) AND creator_id=app.viewer_membership(group_id) AND actor_user_id=(SELECT id FROM app.viewer_identity()));
CREATE POLICY operation_read ON app.expense_operations FOR SELECT TO kami_api USING(app.can_read_group(group_id) AND actor_user_id=(SELECT id FROM app.viewer_identity()));
CREATE POLICY operation_insert ON app.expense_operations FOR INSERT TO kami_api WITH CHECK(app.can_read_group(group_id) AND actor_user_id=(SELECT id FROM app.viewer_identity()));
GRANT SELECT, INSERT ON app.expenses,app.allocations,app.expense_audit,app.expense_operations TO kami_api;
-- Deferred validation sees the entire transaction. Runtime has no UPDATE/DELETE
-- permissions: a later transaction cannot alter financial or recovery history.
CREATE FUNCTION app.check_expense_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE target uuid; e app.expenses; n bigint; owed numeric;
BEGIN
 IF TG_TABLE_NAME='expenses' THEN target:=NEW.id; ELSE target:=NEW.expense_id; END IF;
 IF target IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO STRICT e FROM app.expenses WHERE id=target;
 SELECT count(*),sum(amount_minor) INTO n,owed FROM app.allocations WHERE expense_id=target;
 IF e.creation_tx<>pg_current_xact_id() OR n=0 OR owed<>e.total_minor OR NOT EXISTS(
  SELECT FROM app.expense_audit a WHERE a.expense_id=e.id AND a.group_id=e.group_id
   AND a.creator_id=e.creator_id AND a.committed_at=e.created_at)
 OR NOT EXISTS(SELECT FROM app.expense_operations o JOIN app.expense_audit a ON a.expense_id=o.expense_id
   WHERE o.expense_id=e.id AND o.group_id=e.group_id AND o.actor_user_id=a.actor_user_id)
 THEN RAISE EXCEPTION 'incomplete expense' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER expense_complete AFTER INSERT ON app.expenses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_expense_complete();
CREATE CONSTRAINT TRIGGER allocation_complete AFTER INSERT ON app.allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_expense_complete();
CREATE CONSTRAINT TRIGGER audit_complete AFTER INSERT ON app.expense_audit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_expense_complete();
CREATE CONSTRAINT TRIGGER operation_complete AFTER INSERT ON app.expense_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_expense_complete();
CREATE FUNCTION app.lock_expense_write(target uuid, affected_members uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000'; END IF;
 SELECT u.id INTO actor FROM app.users u WHERE u.auth_subject=app.verified_subject()
  AND u.live_auth_id=u.auth_subject AND u.enabled;
 IF actor IS NULL THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 PERFORM u.id FROM app.users u WHERE u.id=actor OR u.id IN (
  SELECT m.user_id FROM app.memberships m WHERE m.group_id=target AND m.id=ANY(affected_members))
  ORDER BY u.id FOR SHARE;
 PERFORM g.id FROM app.groups g WHERE g.id=target FOR UPDATE;
 IF NOT app.can_read_group(target) THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION app.lock_expense_write(uuid,uuid[]) TO kami_api;
RESET ROLE;
