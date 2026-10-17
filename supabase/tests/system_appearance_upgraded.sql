DO $$
BEGIN
  IF EXISTS (SELECT * FROM public.system_appearance_snapshot EXCEPT SELECT * FROM app.users)
     OR EXISTS (SELECT * FROM app.users EXCEPT SELECT * FROM public.system_appearance_snapshot) THEN
    RAISE EXCEPTION 'prospective default changed existing user rows';
  END IF;
END $$;
INSERT INTO auth.users(id,email) VALUES ('a3250000-0000-4000-8000-000000000004','appearance-new@example.invalid');
SET ROLE kami_migrator;
INSERT INTO app.users(id,auth_subject,live_auth_id,display_name)
VALUES ('a3250000-0000-4000-8000-000000000004','a3250000-0000-4000-8000-000000000004','a3250000-0000-4000-8000-000000000004','New account');
DO $$
BEGIN
  IF (SELECT appearance FROM app.users WHERE id='a3250000-0000-4000-8000-000000000004') IS DISTINCT FROM 'SYSTEM' THEN
    RAISE EXCEPTION 'new account did not inherit SYSTEM';
  END IF;
END $$;
RESET ROLE;
