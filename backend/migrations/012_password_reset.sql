ALTER TABLE users
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN password_reset_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN password_reset_at TIMESTAMPTZ;

CREATE INDEX users_password_reset_by_idx
    ON users(password_reset_by)
    WHERE password_reset_by IS NOT NULL;
