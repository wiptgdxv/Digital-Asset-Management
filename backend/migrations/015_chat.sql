-- Membership intervals enforce that rejoining a project does not restore
-- access to earlier messages.  All membership changes are transactional with
-- the project/collaborator changes that caused them.
CREATE TABLE chat_conversations (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('global', 'project', 'direct')),
    project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
    direct_low BIGINT REFERENCES users(id),
    direct_high BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (kind = 'global' AND project_id IS NULL AND direct_low IS NULL AND direct_high IS NULL)
        OR (kind = 'project' AND project_id IS NOT NULL AND direct_low IS NULL AND direct_high IS NULL)
        OR (kind = 'direct' AND project_id IS NULL AND direct_low IS NOT NULL AND direct_high IS NOT NULL AND direct_low < direct_high)
    )
);
CREATE UNIQUE INDEX chat_one_global ON chat_conversations(kind) WHERE kind = 'global';
CREATE UNIQUE INDEX chat_one_project ON chat_conversations(project_id) WHERE kind = 'project';
CREATE UNIQUE INDEX chat_one_direct ON chat_conversations(direct_low, direct_high) WHERE kind = 'direct';

CREATE TABLE chat_memberships (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    left_at TIMESTAMPTZ,
    last_read_message_id BIGINT NOT NULL DEFAULT 0,
    CHECK (left_at IS NULL OR left_at >= joined_at)
);
CREATE UNIQUE INDEX chat_one_active_membership ON chat_memberships(conversation_id, user_id) WHERE left_at IS NULL;
CREATE INDEX chat_memberships_user ON chat_memberships(user_id, conversation_id) WHERE left_at IS NULL;

CREATE TABLE chat_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    author_id BIGINT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL CHECK (char_length(content) <= 2000),
    reply_to BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    recalled_at TIMESTAMPTZ
);
CREATE INDEX chat_messages_conversation ON chat_messages(conversation_id, id DESC);
CREATE INDEX chat_messages_expiry ON chat_messages(created_at);

CREATE TABLE chat_mentions (
    message_id BIGINT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    PRIMARY KEY (message_id,user_id)
);
CREATE INDEX chat_mentions_user ON chat_mentions(user_id,message_id);

-- Chat uploads have a separate ownership boundary from project attachments.
-- Deleting a message/conversation enqueues the physical body for durable cleanup.
CREATE TABLE chat_uploads (
    id VARCHAR(64) PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    message_id BIGINT UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    relative_path VARCHAR(1000) NOT NULL DEFAULT '',
    batch_id VARCHAR(36) NOT NULL DEFAULT '',
    batch_total INTEGER NOT NULL DEFAULT 1 CHECK (batch_total >= 1 AND batch_total <= 10000),
    size BIGINT NOT NULL CHECK (size >= 0 AND size <= 5000000000),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','complete')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX chat_upload_pending_expiry ON chat_uploads(created_at) WHERE state='pending';
CREATE INDEX chat_upload_completed_batch ON chat_uploads(conversation_id,user_id,batch_id) WHERE state='complete';
CREATE TRIGGER chat_deleted_upload_cleanup AFTER DELETE ON chat_uploads
FOR EACH ROW EXECUTE FUNCTION queue_deleted_upload();

CREATE TABLE chat_reads (
    conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    last_read_message_id BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
);

INSERT INTO chat_conversations(kind) VALUES ('global');
INSERT INTO chat_conversations(kind, project_id) SELECT 'project', id FROM projects;
INSERT INTO chat_memberships(conversation_id, user_id)
SELECT c.id, p.author_id FROM projects p JOIN chat_conversations c ON c.project_id = p.id;
INSERT INTO chat_memberships(conversation_id, user_id)
SELECT c.id, pc.user_id FROM project_collaborators pc JOIN chat_conversations c ON c.project_id = pc.project_id
ON CONFLICT DO NOTHING;

CREATE FUNCTION chat_project_created() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE conversation BIGINT;
BEGIN
    INSERT INTO chat_conversations(kind, project_id) VALUES ('project', NEW.id) RETURNING id INTO conversation;
    INSERT INTO chat_memberships(conversation_id, user_id) VALUES (conversation, NEW.author_id);
    RETURN NEW;
END;
$$;
CREATE TRIGGER chat_after_project_create AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION chat_project_created();

CREATE FUNCTION chat_collaborator_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO chat_memberships(conversation_id, user_id)
        SELECT id, NEW.user_id FROM chat_conversations WHERE project_id = NEW.project_id
        ON CONFLICT DO NOTHING;
        RETURN NEW;
    END IF;
    UPDATE chat_memberships SET left_at = clock_timestamp()
    WHERE conversation_id = (SELECT id FROM chat_conversations WHERE project_id = OLD.project_id)
      AND user_id = OLD.user_id AND left_at IS NULL;
    RETURN OLD;
END;
$$;
CREATE TRIGGER chat_after_collaborator_change AFTER INSERT OR DELETE ON project_collaborators
FOR EACH ROW EXECUTE FUNCTION chat_collaborator_changed();
