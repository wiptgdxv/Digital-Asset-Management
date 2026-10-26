package model

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/auth"
	"errors"

	"digital-assets/backend/internal/types"
)

var (
	ErrLastAdmin         = errors.New("cannot remove the last admin")
	ErrProjectPermission = errors.New("project delete permission denied")
	ErrPasswordChanged   = errors.New("password changed concurrently")
)

func (s *Store) BootstrapAdmin(ctx context.Context, username string) error {
	username = auth.NormalizeUsername(username)
	if username == "" {
		return nil
	}
	_, err := s.DB.ExecContext(ctx, `UPDATE users SET is_admin=true WHERE username=$1`, username)
	return err
}

func (s *Store) SetAdmin(ctx context.Context, userID int64, isAdmin bool) (types.User, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return types.User{}, err
	}
	defer tx.Rollback()
	var user types.User
	if err = tx.QueryRowContext(ctx, `SELECT id,name,username,is_admin FROM users WHERE id=$1 FOR UPDATE`, userID).Scan(&user.Id, &user.Name, &user.Username, &user.IsAdmin); err != nil {
		return types.User{}, err
	}
	if user.IsAdmin && !isAdmin {
		var count int64
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE is_admin`).Scan(&count); err != nil {
			return types.User{}, err
		}
		if count <= 1 {
			return types.User{}, ErrLastAdmin
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE users SET is_admin=$1 WHERE id=$2`, isAdmin, userID); err != nil {
		return types.User{}, err
	}
	user.IsAdmin = isAdmin
	return user, tx.Commit()
}

func (s *Store) ResetPassword(ctx context.Context, userID, adminID int64, passwordHash string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
		UPDATE users
		SET password_hash=$1,must_change_password=true,password_reset_by=$2,password_reset_at=now()
		WHERE id=$3`, passwordHash, adminID, userID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return sql.ErrNoRows
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=$1`, userID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) PasswordHash(ctx context.Context, userID int64) (string, error) {
	var hash string
	err := s.DB.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id=$1`, userID).Scan(&hash)
	return hash, err
}

func (s *Store) ChangePassword(ctx context.Context, userID int64, sessionHash, expectedHash, nextHash string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
		UPDATE users SET password_hash=$1,must_change_password=false
		WHERE id=$2 AND password_hash=$3`, nextHash, userID, expectedHash)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrPasswordChanged
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2`, userID, sessionHash); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteProject(ctx context.Context, projectID, userID int64, isAdmin bool) error {
	result, err := s.DB.ExecContext(ctx, `DELETE FROM projects WHERE id=$1 AND (author_id=$2 OR $3)`, projectID, userID, isAdmin)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 1 {
		return nil
	}
	var exists bool
	if err = s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1)`, projectID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return ErrProjectPermission
	}
	return sql.ErrNoRows
}
