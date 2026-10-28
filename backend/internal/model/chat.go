package model

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/types"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// A project member can see only messages from their current membership.
// The super administrator has project-group access, but never bypasses a direct conversation.
const chatAccess = `(c.kind='global' OR (c.kind='direct' AND ($2=c.direct_low OR $2=c.direct_high)) OR (c.kind='project' AND ($3 OR EXISTS (SELECT 1 FROM chat_memberships cm WHERE cm.conversation_id=c.id AND cm.user_id=$2 AND cm.left_at IS NULL))))`
const chatVisible = `(c.kind<>'project' OR $3 OR m.created_at >= (SELECT cm.joined_at FROM chat_memberships cm WHERE cm.conversation_id=c.id AND cm.user_id=$2 AND cm.left_at IS NULL))`

var chatMentionPattern = regexp.MustCompile(`(?:^|[^A-Za-z0-9._-])@([\p{L}\p{N}._-]{2,32})`)

func (s *Store) ChatConversations(ctx context.Context, userID int64, super bool) ([]types.ChatConversation, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT c.id,c.kind,COALESCE(p.name, CASE WHEN c.kind='global' THEN '全员聊天室' ELSE u.name END),COALESCE(c.project_id,0),
	(SELECT count(*) FROM chat_messages m WHERE m.conversation_id=c.id AND m.id>COALESCE(r.last_read_message_id,0) AND m.author_id<>$2 AND m.created_at>clock_timestamp()-interval '1 month' AND `+chatVisible+`),
	(SELECT count(*) FROM chat_mentions n JOIN chat_messages m ON m.id=n.message_id WHERE n.user_id=$2 AND m.conversation_id=c.id AND m.id>COALESCE(r.last_read_message_id,0) AND m.recalled_at IS NULL AND m.created_at>clock_timestamp()-interval '1 month' AND `+chatVisible+`)
	FROM chat_conversations c LEFT JOIN projects p ON p.id=c.project_id LEFT JOIN users u ON u.id=CASE WHEN c.direct_low=$2 THEN c.direct_high ELSE c.direct_low END
	LEFT JOIN chat_reads r ON r.conversation_id=c.id AND r.user_id=$2
	WHERE $1::int=0 AND `+chatAccess+` ORDER BY c.kind='global' DESC,c.id DESC`, 0, userID, super)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []types.ChatConversation{}
	for rows.Next() {
		var item types.ChatConversation
		if err = rows.Scan(&item.Id, &item.Kind, &item.Name, &item.ProjectId, &item.Unread, &item.Mentions); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) ChatDirect(ctx context.Context, userID, otherID int64) (types.ChatConversation, error) {
	var out types.ChatConversation
	if userID == otherID || otherID < 1 {
		return out, sql.ErrNoRows
	}
	low, high := userID, otherID
	if low > high {
		low, high = high, low
	}
	err := s.DB.QueryRowContext(ctx, `INSERT INTO chat_conversations(kind,direct_low,direct_high)
	SELECT 'direct',$1,$2 WHERE EXISTS(SELECT 1 FROM users WHERE id=$3 AND deleted_at IS NULL)
	ON CONFLICT (direct_low,direct_high) WHERE kind='direct' DO UPDATE SET direct_low=EXCLUDED.direct_low
	RETURNING id,kind`, low, high, otherID).Scan(&out.Id, &out.Kind)
	if err != nil {
		return out, err
	}
	err = s.DB.QueryRowContext(ctx, `SELECT name FROM users WHERE id=$1 AND deleted_at IS NULL`, otherID).Scan(&out.Name)
	return out, err
}

func (s *Store) ChatMembers(ctx context.Context, conversationID, userID int64, super bool, query string) ([]types.User, error) {
	var allowed bool
	if err := s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chat_conversations c WHERE c.id=$1 AND `+chatAccess+`)`, conversationID, userID, super).Scan(&allowed); err != nil {
		return nil, err
	}
	if !allowed {
		return nil, sql.ErrNoRows
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT u.id,u.name,u.username,u.is_admin FROM users u JOIN chat_conversations c ON c.id=$1
	WHERE u.deleted_at IS NULL AND `+chatAccess+` AND (strpos(lower(u.name),lower($4))>0 OR strpos(u.username,lower($4))>0)
	AND (c.kind='global' OR (c.kind='direct' AND u.id IN (c.direct_low,c.direct_high)) OR (c.kind='project' AND EXISTS(SELECT 1 FROM chat_memberships cm WHERE cm.conversation_id=c.id AND cm.user_id=u.id AND cm.left_at IS NULL)))
	ORDER BY u.name,u.id LIMIT 50`, conversationID, userID, super, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []types.User{}
	for rows.Next() {
		var user types.User
		if err = rows.Scan(&user.Id, &user.Name, &user.Username, &user.IsAdmin); err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, rows.Err()
}

func (s *Store) ChatMessages(ctx context.Context, conversationID, userID int64, super bool, before int64) ([]types.ChatMessage, error) {
	return s.ChatFilteredMessages(ctx, conversationID, userID, super, before, "", false)
}

func (s *Store) ChatFilteredMessages(ctx context.Context, conversationID, userID int64, super bool, before int64, query string, filesOnly bool) ([]types.ChatMessage, error) {
	var allowed bool
	if err := s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chat_conversations c WHERE c.id=$1 AND `+chatAccess+`)`, conversationID, userID, super).Scan(&allowed); err != nil {
		return nil, err
	}
	if !allowed {
		return nil, sql.ErrNoRows
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT m.id,m.conversation_id,u.id,u.name,u.username,u.is_admin,CASE WHEN m.recalled_at IS NULL THEN m.content ELSE '' END,m.created_at,m.recalled_at IS NOT NULL,
	COALESCE(f.id,''),COALESCE(f.filename,''),COALESCE(f.relative_path,''),COALESCE(f.size,0),COALESCE(f.batch_id,''),COALESCE(f.batch_total,0),
	CASE WHEN f.id IS NULL THEN 0 WHEN f.batch_id='' THEN 1 ELSE (SELECT count(*) FROM chat_uploads f2 JOIN chat_messages m2 ON m2.id=f2.message_id WHERE f2.conversation_id=c.id AND f2.user_id=m.author_id AND f2.batch_id=f.batch_id AND f2.state='complete' AND m2.recalled_at IS NULL AND m2.created_at>clock_timestamp()-interval '1 month' AND (c.kind<>'project' OR $3 OR m2.created_at >= (SELECT cm.joined_at FROM chat_memberships cm WHERE cm.conversation_id=c.id AND cm.user_id=$2 AND cm.left_at IS NULL))) END,
	CASE WHEN parent.id IS NOT NULL AND parent.recalled_at IS NULL AND parent.created_at>clock_timestamp()-interval '1 month' AND (c.kind<>'project' OR $3 OR parent.created_at >= (SELECT cm.joined_at FROM chat_memberships cm WHERE cm.conversation_id=c.id AND cm.user_id=$2 AND cm.left_at IS NULL)) THEN parent.id ELSE 0 END
	FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id JOIN users u ON u.id=m.author_id LEFT JOIN chat_uploads f ON f.message_id=m.id AND f.state='complete' AND m.recalled_at IS NULL LEFT JOIN chat_messages parent ON parent.id=m.reply_to AND parent.conversation_id=m.conversation_id
	WHERE c.id=$1 AND `+chatAccess+` AND `+chatVisible+` AND m.created_at>clock_timestamp()-interval '1 month' AND ($4=0 OR m.id<$4)
	AND ($5='' OR strpos(lower(m.content),lower($5))>0 OR strpos(lower(COALESCE(f.filename,'')),lower($5))>0)
	AND (NOT $6 OR f.id IS NOT NULL) ORDER BY m.id DESC LIMIT 100`, conversationID, userID, super, before, query, filesOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []types.ChatMessage{}
	for rows.Next() {
		var m types.ChatMessage
		var at time.Time
		if err = rows.Scan(&m.Id, &m.ConversationId, &m.Author.Id, &m.Author.Name, &m.Author.Username, &m.Author.IsAdmin, &m.Content, &at, &m.Recalled, &m.AttachmentId, &m.Filename, &m.RelativePath, &m.Size, &m.BatchId, &m.BatchTotal, &m.BatchCompleted, &m.ReplyTo); err != nil {
			return nil, err
		}
		m.CreatedAt = at.UTC().Format(time.RFC3339Nano)
		if m.AttachmentId != "" {
			m.Previewable = chatPreviewable(m.Filename)
		}
		out = append(out, m)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

func chatPreviewable(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".mp4":
		return true
	default:
		return false
	}
}

func (s *Store) ChatSend(ctx context.Context, conversationID, userID int64, super bool, content string, replyTo int64) (types.ChatMessage, error) {
	var out types.ChatMessage
	var at time.Time
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var kind string
	// Serializing message creation per conversation keeps message IDs in commit
	// order, so the read watermark cannot skip a later-committing message.
	if err = tx.QueryRowContext(ctx, `SELECT c.kind FROM chat_conversations c WHERE c.id=$1 AND `+chatAccess+` FOR UPDATE`, conversationID, userID, super).Scan(&kind); err != nil {
		return out, err
	}
	if kind == "project" && !super {
		var membership int64
		if err = tx.QueryRowContext(ctx, `SELECT id FROM chat_memberships WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL FOR SHARE`, conversationID, userID).Scan(&membership); err != nil {
			return out, err
		}
	}
	err = tx.QueryRowContext(ctx, `INSERT INTO chat_messages(conversation_id,author_id,content,reply_to) SELECT c.id,$2,$4,NULLIF($5,0) FROM chat_conversations c WHERE c.id=$1 AND `+chatAccess+` AND ($5=0 OR EXISTS(SELECT 1 FROM chat_messages m WHERE m.id=$5 AND m.conversation_id=c.id AND m.recalled_at IS NULL AND m.created_at>clock_timestamp()-interval '1 month' AND `+chatVisible+`)) RETURNING id,conversation_id,created_at`, conversationID, userID, super, content, replyTo).Scan(&out.Id, &out.ConversationId, &at)
	if err != nil {
		return out, err
	}
	out.Content = content
	out.ReplyTo = replyTo
	out.CreatedAt = at.UTC().Format(time.RFC3339Nano)
	seen := map[string]bool{}
	for _, match := range chatMentionPattern.FindAllStringSubmatch(content, -1) {
		username := auth.NormalizeUsername(match[1])
		if seen[username] {
			continue
		}
		seen[username] = true
		_, err = tx.ExecContext(ctx, `INSERT INTO chat_mentions(message_id,user_id)
		SELECT $1,u.id FROM users u JOIN chat_conversations c ON c.id=$2 WHERE u.username=$3 AND u.id<>$4 AND u.deleted_at IS NULL AND (c.kind='global' OR (c.kind='direct' AND u.id IN (c.direct_low,c.direct_high)) OR (c.kind='project' AND EXISTS (SELECT 1 FROM chat_memberships cm WHERE cm.conversation_id=c.id AND cm.user_id=u.id AND cm.left_at IS NULL))) ON CONFLICT DO NOTHING`, out.Id, conversationID, username, userID)
		if err != nil {
			return types.ChatMessage{}, err
		}
	}
	err = tx.QueryRowContext(ctx, `SELECT id,name,username,is_admin FROM users WHERE id=$1 AND deleted_at IS NULL`, userID).Scan(&out.Author.Id, &out.Author.Name, &out.Author.Username, &out.Author.IsAdmin)
	if err != nil {
		return types.ChatMessage{}, err
	}
	if err = tx.Commit(); err != nil {
		return types.ChatMessage{}, err
	}
	return out, nil
}

func (s *Store) ChatRead(ctx context.Context, conversationID, userID int64, super bool, lastMessageID int64) error {
	result, err := s.DB.ExecContext(ctx, `INSERT INTO chat_reads(conversation_id,user_id,last_read_message_id)
	SELECT c.id,$2,COALESCE((SELECT max(m.id) FROM chat_messages m WHERE m.conversation_id=c.id AND m.id <= $4 AND `+chatVisible+`),0) FROM chat_conversations c WHERE c.id=$1 AND `+chatAccess+`
	ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_message_id=GREATEST(chat_reads.last_read_message_id,EXCLUDED.last_read_message_id)`, conversationID, userID, super, lastMessageID)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return err
}

func (s *Store) ChatRecall(ctx context.Context, messageID, userID int64, super bool) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE chat_messages m SET recalled_at=clock_timestamp(),content='' FROM chat_conversations c WHERE m.id=$1 AND m.author_id=$2 AND c.id=m.conversation_id AND `+chatAccess+` AND `+chatVisible+` AND m.created_at>clock_timestamp()-interval '1 month'`, messageID, userID, super)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return sql.ErrNoRows
	}
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM chat_uploads WHERE message_id=$1`, messageID); err != nil {
		return err
	}
	return tx.Commit()
}

// PurgeExpiredChatMessages removes messages after one calendar month.
func (s *Store) PurgeExpiredChatMessages(ctx context.Context) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `DELETE FROM chat_messages WHERE created_at <= clock_timestamp() - interval '1 month'`); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM chat_uploads WHERE state='pending' AND created_at <= clock_timestamp() - interval '7 days'`); err != nil {
		return err
	}
	return tx.Commit()
}
