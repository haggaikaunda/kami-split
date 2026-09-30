DO $$
BEGIN
 IF (SELECT count(*) FROM public.repayment_upgrade_snapshot)<>1 OR EXISTS(
  SELECT expense,operation,audit FROM public.repayment_upgrade_snapshot
  EXCEPT SELECT to_jsonb(e),to_jsonb(o)-'repayment_id',to_jsonb(a) FROM app.expenses e JOIN app.expense_operations o ON o.expense_id=e.id JOIN app.expense_audit a ON a.expense_id=e.id
 ) OR (SELECT count(*) FROM app.financial_records WHERE record_id='a1100000-0000-4000-8000-000000000004' AND revision=1 AND kind='CREATE_EXPENSE')<>1 THEN
  RAISE EXCEPTION 'repayment upgrade altered expense history or failed revision backfill';
 END IF;
END $$;
DROP TABLE public.repayment_upgrade_snapshot;
