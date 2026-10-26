package model

import (
	"context"
	"database/sql"
	"time"

	"digital-assets/backend/internal/types"
)

func commentTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

func (s *Store) CreateComment(ctx context.Context, projectID int64, user types.User, content string, mentions []string) (types.Comment, error) {
	comment := types.Comment{ProjectId: projectID, UserId: user.Id, User: user, Content: content, Replies: []types.Reply{}}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return types.Comment{}, err
	}
	defer tx.Rollback()
	var createdAt, updatedAt time.Time
	err = tx.QueryRowContext(ctx, `
		INSERT INTO comments(project_id,user_id,content,parent_id)
		SELECT $1,$2,$3,NULL WHERE EXISTS(SELECT 1 FROM projects WHERE id=$1)
		RETURNING id,created_at,updated_at`, projectID, user.Id, content,
	).Scan(&comment.Id, &createdAt, &updatedAt)
	if err != nil {
		return types.Comment{}, err
	}
	if err = insertMentionNotifications(ctx, tx, mentions, user.Id, projectID, comment.Id); err != nil {
		return types.Comment{}, err
	}
	if err = tx.Commit(); err != nil {
		return types.Comment{}, err
	}
	comment.CreatedAt = commentTime(createdAt)
	comment.UpdatedAt = commentTime(updatedAt)
	return comment, nil
}

func (s *Store) CreateReply(ctx context.Context, commentID int64, user types.User, content string, mentions []string) (types.Reply, error) {
	reply := types.Reply{CommentId: commentID, UserId: user.Id, User: user, Content: content}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return types.Reply{}, err
	}
	defer tx.Rollback()
	var projectID int64
	var createdAt, updatedAt time.Time
	err = tx.QueryRowContext(ctx, `
		INSERT INTO comments(project_id,user_id,content,parent_id)
		SELECT project_id,$2,$3,id FROM comments WHERE id=$1 AND parent_id IS NULL
		RETURNING id,project_id,created_at,updated_at`, commentID, user.Id, content,
	).Scan(&reply.Id, &projectID, &createdAt, &updatedAt)
	if err != nil {
		return types.Reply{}, err
	}
	if err = insertMentionNotifications(ctx, tx, mentions, user.Id, projectID, reply.Id); err != nil {
		return types.Reply{}, err
	}
	if err = tx.Commit(); err != nil {
		return types.Reply{}, err
	}
	reply.CreatedAt = commentTime(createdAt)
	reply.UpdatedAt = commentTime(updatedAt)
	return reply, nil
}

func insertMentionNotifications(ctx context.Context, tx *sql.Tx, usernames []string, actorID, projectID, commentID int64) error {
	for _, username := range usernames {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO notifications(user_id,actor_id,project_id,comment_id)
			SELECT id,$2,$3,$4 FROM users WHERE username=$1 AND id<>$2
			ON CONFLICT (user_id,comment_id) DO NOTHING`, username, actorID, projectID, commentID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Comments(ctx context.Context, projectID int64) ([]types.Comment, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var exists bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1)`, projectID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, sql.ErrNoRows
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT c.id,c.project_id,c.user_id,u.name,u.username,u.is_admin,c.content,c.created_at,c.updated_at
		FROM comments c JOIN users u ON u.id=c.user_id
		WHERE c.project_id=$1 AND c.parent_id IS NULL
		ORDER BY c.created_at DESC,c.id DESC`, projectID)
	if err != nil {
		return nil, err
	}
	comments := make([]types.Comment, 0)
	for rows.Next() {
		var comment types.Comment
		var createdAt, updatedAt time.Time
		if err = rows.Scan(&comment.Id, &comment.ProjectId, &comment.UserId, &comment.User.Name, &comment.User.Username, &comment.User.IsAdmin, &comment.Content, &createdAt, &updatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		comment.User.Id = comment.UserId
		comment.CreatedAt = commentTime(createdAt)
		comment.UpdatedAt = commentTime(updatedAt)
		comment.Replies = []types.Reply{}
		comments = append(comments, comment)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	replyRows, err := tx.QueryContext(ctx, `
		SELECT c.id,c.parent_id,c.user_id,u.name,u.username,u.is_admin,c.content,c.created_at,c.updated_at
		FROM comments c JOIN users u ON u.id=c.user_id
		WHERE c.project_id=$1 AND c.parent_id IS NOT NULL
		ORDER BY c.created_at ASC,c.id ASC`, projectID)
	if err != nil {
		return nil, err
	}
	grouped := make(map[int64][]types.Reply)
	for replyRows.Next() {
		var reply types.Reply
		var createdAt, updatedAt time.Time
		if err = replyRows.Scan(&reply.Id, &reply.CommentId, &reply.UserId, &reply.User.Name, &reply.User.Username, &reply.User.IsAdmin, &reply.Content, &createdAt, &updatedAt); err != nil {
			replyRows.Close()
			return nil, err
		}
		reply.User.Id = reply.UserId
		reply.CreatedAt = commentTime(createdAt)
		reply.UpdatedAt = commentTime(updatedAt)
		grouped[reply.CommentId] = append(grouped[reply.CommentId], reply)
	}
	if err = replyRows.Err(); err != nil {
		replyRows.Close()
		return nil, err
	}
	replyRows.Close()
	for i := range comments {
		if replies, ok := grouped[comments[i].Id]; ok {
			comments[i].Replies = replies
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return comments, nil
}
