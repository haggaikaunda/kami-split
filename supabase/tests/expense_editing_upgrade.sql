-- Capture shipped creation facts before adding guarded current projections.
CREATE TABLE public.expense_editing_upgrade_snapshot AS
 SELECT e.id,to_jsonb(e) expense,
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY participant_id) FROM app.allocations a WHERE a.expense_id=e.id) allocations,
 (SELECT to_jsonb(a) FROM app.expense_audit a WHERE a.expense_id=e.id) audit,
 (SELECT to_jsonb(o) FROM app.expense_operations o WHERE o.expense_id=e.id) operation
 FROM app.expenses e;
