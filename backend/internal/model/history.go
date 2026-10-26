package model

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"digital-assets/backend/internal/types"
)

type projectSnapshot struct {
	Name        string
	Summary     string
	Readme      string
	Category    string
	DemoEnabled bool
}

type historyExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func insertProjectVersion(ctx context.Context, exec historyExecer, projectID, version, editorID int64, snapshot projectSnapshot, collaboratorIDs []int64, action string, changedFields []string, restoredFrom int64) error {
	collaborators, err := json.Marshal(collaboratorIDs)
	if err != nil {
		return err
	}
	changes, err := json.Marshal(changedFields)
	if err != nil {
		return err
	}
	var restored any
	if restoredFrom > 0 {
		restored = restoredFrom
	}
	_, err = exec.ExecContext(ctx, `
		INSERT INTO project_versions(
		 project_id,version,editor_id,name,summary,readme,category,demo_enabled,
		 collaborator_ids,action,changed_fields,restored_from_version
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		projectID, version, editorID, snapshot.Name, snapshot.Summary, snapshot.Readme,
		snapshot.Category, snapshot.DemoEnabled, collaborators, action, changes, restored,
	)
	return err
}

func changedProjectFields(before, after projectSnapshot, beforeCollaborators, afterCollaborators []int64) []string {
	fields := make([]string, 0, 6)
	if before.Name != after.Name {
		fields = append(fields, "name")
	}
	if before.Summary != after.Summary {
		fields = append(fields, "summary")
	}
	if before.Readme != after.Readme {
		fields = append(fields, "readme")
	}
	if before.Category != after.Category {
		fields = append(fields, "category")
	}
	if before.DemoEnabled != after.DemoEnabled {
		fields = append(fields, "demoEnabled")
	}
	if !sameIDs(beforeCollaborators, afterCollaborators) {
		fields = append(fields, "collaborators")
	}
	return fields
}

func (s *Store) ProjectHistory(ctx context.Context, projectID, page int64) (*types.ProjectHistoryResponse, error) {
	result := &types.ProjectHistoryResponse{Items: []types.ProjectHistoryItem{}}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var projectExists bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1)`, projectID).Scan(&projectExists); err != nil {
		return nil, err
	}
	if !projectExists {
		return nil, sql.ErrNoRows
	}
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM project_versions WHERE project_id=$1`, projectID).Scan(&result.Total); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT v.id,v.version,u.id,u.name,u.username,u.is_admin,v.action,v.changed_fields,
		       v.restored_from_version,v.created_at
		FROM project_versions v JOIN users u ON u.id=v.editor_id
		WHERE v.project_id=$1
		ORDER BY v.version DESC,v.id DESC
		LIMIT 20 OFFSET $2`, projectID, (page-1)*20)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item types.ProjectHistoryItem
		var fields []byte
		var restored sql.NullInt64
		var created time.Time
		if err = rows.Scan(&item.Id, &item.Version, &item.Editor.Id, &item.Editor.Name, &item.Editor.Username, &item.Editor.IsAdmin, &item.Action, &fields, &restored, &created); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(fields, &item.ChangedFields); err != nil {
			return nil, err
		}
		if restored.Valid {
			item.RestoredFromVersion = restored.Int64
		}
		item.CreatedAt = created.UTC().Format(time.RFC3339)
		result.Items = append(result.Items, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

type rowQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func collaboratorIDs(ctx context.Context, query rowQuerier, projectID int64) ([]int64, error) {
	rows, err := query.QueryContext(ctx, `SELECT user_id FROM project_collaborators WHERE project_id=$1 ORDER BY user_id`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
