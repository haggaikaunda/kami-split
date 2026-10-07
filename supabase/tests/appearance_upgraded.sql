-- Existing identities receive the explicit light preference during upgrade.
SET ROLE kami_migrator;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM app.users) THEN RAISE EXCEPTION 'missing upgrade identities'; END IF;
  IF EXISTS (SELECT FROM app.users WHERE appearance IS DISTINCT FROM 'LIGHT') THEN
    RAISE EXCEPTION 'appearance migration did not default existing users to LIGHT';
  END IF;
END $$;
RESET ROLE;
