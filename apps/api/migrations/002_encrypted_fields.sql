-- Run with the application stopped. The runner encrypts every pre-existing value
-- using the configured key inside THIS transaction, then validates these checks.
-- Keys and plaintext never appear in SQL migration files or migration logs.
ALTER TABLE incidents RENAME COLUMN description TO description_ciphertext;
ALTER TABLE notes RENAME COLUMN body TO body_ciphertext;
ALTER TABLE incidents ADD CONSTRAINT incidents_description_envelope
  CHECK (description_ciphertext ~ '^ib:v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$') NOT VALID;
ALTER TABLE notes ADD CONSTRAINT notes_body_envelope
  CHECK (body_ciphertext ~ '^ib:v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$') NOT VALID;
