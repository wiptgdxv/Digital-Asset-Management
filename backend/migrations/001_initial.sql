CREATE TABLE users (
 id BIGSERIAL PRIMARY KEY,
 name VARCHAR(60) NOT NULL,
 email VARCHAR(254) NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 id BIGSERIAL PRIMARY KEY,
 token_hash VARCHAR(64) NOT NULL UNIQUE,
 csrf_token VARCHAR(64) NOT NULL,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE projects (
 id BIGSERIAL PRIMARY KEY,
 name VARCHAR(120) NOT NULL,
 summary VARCHAR(500) NOT NULL,
 readme TEXT NOT NULL DEFAULT '',
 category VARCHAR(20) NOT NULL CHECK (category IN ('软件','设计','数据','文档','其他')),
 demo_enabled BOOLEAN NOT NULL DEFAULT false,
 author_id BIGINT NOT NULL REFERENCES users(id),
 last_editor_id BIGINT NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX projects_updated ON projects(updated_at DESC, id DESC);
CREATE TABLE project_collaborators (
 id BIGSERIAL PRIMARY KEY,
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id),
 UNIQUE(project_id, user_id)
);
CREATE INDEX collaborators_user ON project_collaborators(user_id, project_id);
