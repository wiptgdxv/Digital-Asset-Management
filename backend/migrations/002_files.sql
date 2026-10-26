CREATE TABLE upload_records (
 id VARCHAR(64) PRIMARY KEY,
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id),
 filename VARCHAR(255) NOT NULL,
 size BIGINT NOT NULL CHECK(size >= 0 AND size <= 5000000000),
 replace_id BIGINT NOT NULL DEFAULT 0,
 expected_upload VARCHAR(64) NOT NULL DEFAULT '',
 state VARCHAR(20) NOT NULL DEFAULT 'pending',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE project_files (
 id BIGSERIAL PRIMARY KEY,
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 upload_id VARCHAR(64) NOT NULL UNIQUE REFERENCES upload_records(id),
 filename VARCHAR(255) NOT NULL,
 size BIGINT NOT NULL,
 uploader_id BIGINT NOT NULL REFERENCES users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX files_project ON project_files(project_id,id);
CREATE TABLE file_cleanup (upload_id VARCHAR(64) PRIMARY KEY);
