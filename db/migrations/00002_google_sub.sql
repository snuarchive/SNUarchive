-- +goose Up

-- Accounts are keyed by Google's stable subject id, not by email: a school
-- address can be reissued, and the new holder must not inherit the old
-- account. A live account may lose its email to such a holder; it keeps its
-- sub and gets its current email back at its next sign-in. Rows made by dev
-- login have no sub and always keep their email.
ALTER TABLE users ADD COLUMN google_sub text;
ALTER TABLE users ADD CONSTRAINT users_google_sub_u UNIQUE (google_sub);
ALTER TABLE users ADD CONSTRAINT users_google_sub_ck CHECK (google_sub IS NULL OR google_sub ~ '^[0-9A-Za-z_-]{1,255}$');

ALTER TABLE users DROP CONSTRAINT users_live_ck;
ALTER TABLE users ADD CONSTRAINT users_live_ck
  CHECK (deleted_at IS NOT NULL OR email IS NOT NULL OR google_sub IS NOT NULL);

ALTER TABLE users DROP CONSTRAINT users_scrubbed_ck;
ALTER TABLE users ADD CONSTRAINT users_scrubbed_ck CHECK (
  deleted_at IS NULL
  OR (email IS NULL AND google_sub IS NULL AND display_name IS NULL AND college IS NULL
      AND admission_year IS NULL AND last_ip IS NULL AND is_admin = false)
);

-- +goose Down

ALTER TABLE users DROP CONSTRAINT users_scrubbed_ck;
ALTER TABLE users DROP CONSTRAINT users_live_ck;

-- A row only its sub kept alive cannot satisfy the old rules; it is scrubbed
-- rather than deleted, because contributions and logs still reference it.
UPDATE users
SET deleted_at = now(), display_name = NULL, college = NULL, admission_year = NULL,
    last_ip = NULL, is_admin = false
WHERE deleted_at IS NULL AND email IS NULL;

ALTER TABLE users ADD CONSTRAINT users_live_ck CHECK (deleted_at IS NOT NULL OR email IS NOT NULL);
ALTER TABLE users ADD CONSTRAINT users_scrubbed_ck CHECK (
  deleted_at IS NULL
  OR (email IS NULL AND display_name IS NULL AND college IS NULL
      AND admission_year IS NULL AND last_ip IS NULL AND is_admin = false)
);

ALTER TABLE users DROP CONSTRAINT users_google_sub_ck;
ALTER TABLE users DROP CONSTRAINT users_google_sub_u;
ALTER TABLE users DROP COLUMN google_sub;
