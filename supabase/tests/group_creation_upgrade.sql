-- Disposable upgrade fixture, applied after #75 and before #103.
BEGIN;
INSERT INTO auth.users(id,email) VALUES('a1030000-0000-4000-8000-000000000001','upgrade-103@example.invalid');
SET LOCAL ROLE kami_migrator;
INSERT INTO app.users(id, auth_subject, live_auth_id, display_name)
VALUES(
  'a1030000-0000-4000-8000-000000000001', 'a1030000-0000-4000-8000-000000000001',
  'a1030000-0000-4000-8000-000000000001', 'Upgrade'
);
INSERT INTO app.groups(id, name, owner_membership_id)
VALUES(
  'a1030000-0000-4000-8000-000000000002', 'Existing household', 'a1030000-0000-4000-8000-000000000003'
);
INSERT INTO app.memberships(id, group_id, user_id)
VALUES(
  'a1030000-0000-4000-8000-000000000003', 'a1030000-0000-4000-8000-000000000002',
  'a1030000-0000-4000-8000-000000000001'
);
INSERT INTO app.installation(household_group_id, group_creator_user_id)
VALUES('a1030000-0000-4000-8000-000000000002', 'a1030000-0000-4000-8000-000000000001');
-- Outside app so this test-only snapshot never affects schema reconciliation.
RESET ROLE;
CREATE TABLE public.group_creation_upgrade_snapshot AS
SELECT to_jsonb(u) AS identity, to_jsonb(g) AS group_row, to_jsonb(m) AS membership, to_jsonb(i) AS installation
FROM app.users u CROSS JOIN app.groups g CROSS JOIN app.memberships m CROSS JOIN app.installation i;
COMMIT;
