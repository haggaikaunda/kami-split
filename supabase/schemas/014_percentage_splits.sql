-- Additive #199 extension: retain old canonical bytes, outcomes and uniqueness.
SET ROLE kami_migrator;
ALTER TABLE app.expenses DROP CONSTRAINT expenses_split_check;
ALTER TABLE app.expenses ADD CONSTRAINT expenses_split_check CHECK(split IN ('EQUAL','EXACT','PERCENTAGE'));
ALTER TABLE app.allocations ADD COLUMN percentage_hundredths integer CHECK(percentage_hundredths BETWEEN 0 AND 10000);
ALTER TABLE app.expense_operations DROP CONSTRAINT financial_operation_kind;
ALTER TABLE app.expense_operations ADD CONSTRAINT financial_operation_kind CHECK(
 (operation_kind='CREATE_EXPENSE' AND canonical_version IN ('create-expense-v1','create-expense-percentage-v2') AND repayment_id IS NULL)
 OR (operation_kind='RECORD_REPAYMENT' AND canonical_version='record-repayment-v1' AND expense_id IS NULL));

-- The original completeness trigger still enforces expense/audit/result atomicity.
-- This additional deferred check sees every selected share and the frozen outcome.
CREATE FUNCTION app.check_percentage_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE target uuid; e app.expenses; n bigint; percentage_count bigint; percentage_sum numeric;
 intended jsonb; resolved jsonb;
BEGIN
 IF TG_TABLE_NAME='expenses' THEN target:=NEW.id; ELSE target:=NEW.expense_id; END IF;
 IF target IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO STRICT e FROM app.expenses WHERE id=target;
 SELECT count(*),count(percentage_hundredths),sum(percentage_hundredths) INTO n,percentage_count,percentage_sum
 FROM app.allocations WHERE expense_id=target;
 IF e.split<>'PERCENTAGE' THEN
  IF percentage_count<>0 THEN RAISE EXCEPTION 'unexpected percentage intent' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF n=0 OR percentage_count<>n OR percentage_sum<>10000 THEN
  RAISE EXCEPTION 'incomplete percentage intent' USING ERRCODE='23514';
 END IF;
 -- numeric products keep this independently checked computation exact.
 IF EXISTS(WITH shares AS (
  SELECT participant_id,amount_minor,percentage_hundredths,
   floor(e.total_minor::numeric*percentage_hundredths/10000) AS base,
   mod(e.total_minor::numeric*percentage_hundredths,10000) AS remainder
  FROM app.allocations WHERE expense_id=target
 ), ranked AS (
  SELECT *,row_number() OVER(ORDER BY remainder DESC,participant_id ASC) AS rank,
   e.total_minor-sum(base) OVER() AS remaining FROM shares
 ) SELECT FROM ranked WHERE amount_minor<>base+CASE WHEN rank<=remaining AND percentage_hundredths>0 THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'incorrect percentage allocation' USING ERRCODE='23514'; END IF;
 SELECT jsonb_agg(jsonb_build_object('ParticipantID','ks1:Membership:'||participant_id::text,'Hundredths',percentage_hundredths) ORDER BY participant_id),
 jsonb_agg(jsonb_build_object('ParticipantID','ks1:Membership:'||participant_id::text,'Amount',amount_minor) ORDER BY participant_id)
 INTO intended,resolved FROM app.allocations WHERE expense_id=target;
 IF NOT EXISTS(SELECT FROM app.expense_operations o WHERE o.expense_id=target
  AND o.canonical_version='create-expense-percentage-v2'
  AND o.outcome->'Record'->>'Split'='PERCENTAGE'
  AND o.outcome->'Record'->'Percentages'=intended
  AND o.outcome->'Record'->'Allocations'=resolved)
 THEN RAISE EXCEPTION 'incomplete percentage outcome' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER percentage_expense_complete AFTER INSERT ON app.expenses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_percentage_complete();
CREATE CONSTRAINT TRIGGER percentage_allocation_complete AFTER INSERT ON app.allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_percentage_complete();
CREATE CONSTRAINT TRIGGER percentage_operation_complete AFTER INSERT ON app.expense_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_percentage_complete();
RESET ROLE;
