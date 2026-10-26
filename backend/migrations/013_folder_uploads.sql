ALTER TABLE upload_records
    ADD COLUMN relative_path VARCHAR(1000) NOT NULL DEFAULT '';

ALTER TABLE project_files
    ADD COLUMN relative_path VARCHAR(1000) NOT NULL DEFAULT '';

CREATE INDEX project_files_project_path_idx
    ON project_files(project_id, kind, relative_path, filename);
