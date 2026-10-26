ALTER TABLE upload_records
    ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'project',
    ADD CONSTRAINT upload_records_kind_check CHECK (kind IN ('project', 'demo'));

ALTER TABLE project_files
    ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'project',
    ADD CONSTRAINT project_files_kind_check CHECK (kind IN ('project', 'demo'));

CREATE INDEX project_files_project_kind_updated_idx
    ON project_files(project_id, kind, updated_at DESC, id DESC);
