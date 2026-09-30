DO $$
BEGIN
 IF (SELECT count(*) FROM public.group_creation_upgrade_snapshot)<>1 OR EXISTS(
  SELECT identity,group_row,membership,installation FROM public.group_creation_upgrade_snapshot
  EXCEPT SELECT to_jsonb(u),to_jsonb(g),to_jsonb(m),to_jsonb(i)
  FROM app.users u CROSS JOIN app.groups g CROSS JOIN app.memberships m CROSS JOIN app.installation i
 ) OR EXISTS(SELECT FROM app.group_trip) OR EXISTS(SELECT FROM app.group_creation_attempts) THEN
  RAISE EXCEPTION 'group creation upgrade changed existing identity/group/designation';
 END IF;
END $$;
BEGIN;
SET LOCAL ROLE kami_migrator;
DELETE FROM app.installation;
DELETE FROM app.memberships WHERE id='a1030000-0000-4000-8000-000000000003';
DELETE FROM app.groups WHERE id='a1030000-0000-4000-8000-000000000002';
DELETE FROM app.users WHERE id='a1030000-0000-4000-8000-000000000001';
RESET ROLE;
DELETE FROM auth.users WHERE id='a1030000-0000-4000-8000-000000000001';
DROP TABLE public.group_creation_upgrade_snapshot;
COMMIT;
