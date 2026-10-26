ALTER TABLE users
ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX users_admins ON users(id) WHERE is_admin;
