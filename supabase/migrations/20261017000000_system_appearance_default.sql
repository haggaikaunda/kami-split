-- Prospective default only: legacy LIGHT cannot be distinguished from a choice.
SET ROLE kami_migrator;
ALTER TABLE app.users ALTER COLUMN appearance SET DEFAULT 'SYSTEM';
RESET ROLE;
