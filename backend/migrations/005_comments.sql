CREATE TABLE comments (
 id BIGSERIAL PRIMARY KEY,
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 parent_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id),
 content TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_project ON comments(project_id, created_at DESC, id DESC);
CREATE INDEX comments_parent ON comments(parent_id, created_at, id);
