package model

import (
	"context"
	"database/sql"
	"time"

	"digital-assets/backend/internal/types"
)

func (s *Store) Notifications(ctx context.Context, userID int64) (types.NotificationsResponse, error) {
	result := types.NotificationsResponse{Items: []types.Notification{}}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM notifications WHERE user_id=$1 AND is_read=false`, userID).Scan(&result.Unread); err != nil {
		return result, err
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT n.id,a.id,a.name,a.username,a.is_admin,n.project_id,p.name,n.comment_id,c.content,n.is_read,n.created_at
		FROM notifications n
		JOIN users a ON a.id=n.actor_id
		JOIN projects p ON p.id=n.project_id
		JOIN comments c ON c.id=n.comment_id
		WHERE n.user_id=$1
		ORDER BY n.created_at DESC,n.id DESC
		LIMIT 50`, userID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var item types.Notification
		var createdAt time.Time
		if err = rows.Scan(&item.Id, &item.Actor.Id, &item.Actor.Name, &item.Actor.Username, &item.Actor.IsAdmin, &item.ProjectId, &item.ProjectName, &item.CommentId, &item.Content, &item.IsRead, &createdAt); err != nil {
			return result, err
		}
		item.CreatedAt = commentTime(createdAt)
		result.Items = append(result.Items, item)
	}
	if err = rows.Err(); err != nil {
		return result, err
	}
	rows.Close()
	if err = tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}

func (s *Store) ReadNotifications(ctx context.Context, userID int64) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE notifications SET is_read=true WHERE user_id=$1 AND is_read=false`, userID)
	return err
}
