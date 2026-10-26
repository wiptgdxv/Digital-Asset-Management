CREATE TABLE project_versions (
 id BIGSERIAL PRIMARY KEY,
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version BIGINT NOT NULL,
 editor_id BIGINT NOT NULL REFERENCES users(id),
 name VARCHAR(120) NOT NULL,
 summary VARCHAR(500) NOT NULL,
 readme TEXT NOT NULL,
 category VARCHAR(20) NOT NULL CHECK (category IN ('软件','设计','数据','文档','其他')),
 demo_enabled BOOLEAN NOT NULL,
 collaborator_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(collaborator_ids) = 'array'),
 action VARCHAR(20) NOT NULL CHECK (action IN ('create','edit','restore','baseline')),
 changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changed_fields) = 'array'),
 restored_from_version BIGINT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(project_id, version)
);

CREATE INDEX project_versions_project
ON project_versions(project_id, version DESC);

INSERT INTO project_versions(
 project_id,version,editor_id,name,summary,readme,category,demo_enabled,
 collaborator_ids,action,changed_fields,created_at
)
SELECT
 p.id,p.version,p.last_editor_id,p.name,p.summary,p.readme,p.category,p.demo_enabled,
 COALESCE(
  (SELECT jsonb_agg(c.user_id ORDER BY c.user_id) FROM project_collaborators c WHERE c.project_id=p.id),
  '[]'::jsonb
 ),
 'baseline','["baseline"]'::jsonb,p.updated_at
FROM projects p;
