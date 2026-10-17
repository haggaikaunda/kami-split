-- Preserve explicit values and unrelated row fields across the default change.
INSERT INTO auth.users(id,email)
SELECT ('a3250000-0000-4000-8000-00000000000' || n)::uuid,
       'appearance-upgrade-' || n || '@example.invalid'
FROM generate_series(1,3) n;
SET ROLE kami_migrator;
INSERT INTO app.users(id,auth_subject,live_auth_id,display_name,appearance)
SELECT id,id,id,'Appearance upgrade', CASE n WHEN 1 THEN 'LIGHT' WHEN 2 THEN 'DARK' ELSE 'SYSTEM' END
FROM (SELECT n, ('a3250000-0000-4000-8000-00000000000' || n)::uuid AS id FROM generate_series(1,3) n) fixture;
RESET ROLE;
CREATE TABLE public.system_appearance_snapshot AS SELECT * FROM app.users;
