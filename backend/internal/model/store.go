package model

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/types"
	"encoding/json"
	"errors"
	"sort"
	"time"
)

type Store struct{ DB *sql.DB }

func (s *Store) Register(ctx context.Context, name, username, hash string, isAdmin bool) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO users(name,username,password_hash,is_admin) VALUES($1,$2,$3,$4)`, name, username, hash, isAdmin)
	return err
}
func (s *Store) LoginUser(ctx context.Context, username string) (types.User, string, bool, error) {
	var u types.User
	var hash string
	var mustChangePassword bool
	err := s.DB.QueryRowContext(ctx, `SELECT id,name,username,is_admin,password_hash,must_change_password FROM users WHERE username=$1`, username).Scan(&u.Id, &u.Name, &u.Username, &u.IsAdmin, &hash, &mustChangePassword)
	return u, hash, mustChangePassword, err
}
func (s *Store) CreateSession(ctx context.Context, hash, csrf string, id int64) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')`, hash, csrf, id)
	return err
}
func (s *Store) Session(ctx context.Context, hash string) (auth.Session, error) {
	var session auth.Session
	session.Hash = hash
	err := s.DB.QueryRowContext(ctx, `SELECT u.id,u.name,u.username,u.is_admin,s.csrf_token,u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, hash).Scan(&session.User.Id, &session.User.Name, &session.User.Username, &session.User.IsAdmin, &session.Csrf, &session.MustChangePassword)
	return session, err
}
func (s *Store) Logout(ctx context.Context, hash string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash=$1`, hash)
	return err
}
func (s *Store) Users(ctx context.Context, q string) ([]types.User, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id,name,username,is_admin FROM users WHERE strpos(lower(name),lower($1))>0 OR strpos(username,lower($1))>0 ORDER BY name,id LIMIT 50`, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []types.User{}
	for rows.Next() {
		var u types.User
		if err := rows.Scan(&u.Id, &u.Name, &u.Username, &u.IsAdmin); err != nil {
			return nil, err
		}
		result = append(result, u)
	}
	return result, rows.Err()
}
func (s *Store) CreateProject(ctx context.Context, req *types.ProjectRequest, author int64) (int64, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var id int64
	err = tx.QueryRowContext(ctx, `INSERT INTO projects(name,summary,readme,category,demo_enabled,author_id,last_editor_id) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id`, req.Name, req.Summary, req.Readme, req.Category, req.DemoEnabled, author).Scan(&id)
	if err != nil {
		return 0, err
	}
	collaborators := canonicalCollaboratorIDs(req.CollaboratorIds, author)
	for _, uid := range collaborators {
		if _, err = tx.ExecContext(ctx, `INSERT INTO project_collaborators(project_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, uid); err != nil {
			return 0, err
		}
	}
	snapshot := projectSnapshot{Name: req.Name, Summary: req.Summary, Readme: req.Readme, Category: req.Category, DemoEnabled: req.DemoEnabled}
	if err = insertProjectVersion(ctx, tx, id, 1, author, snapshot, collaborators, "create", []string{"created"}, 0); err != nil {
		return 0, err
	}
	return id, tx.Commit()
}

const projectColumns = `p.id,p.version,p.name,p.summary,p.readme,p.category,p.demo_enabled,p.created_at,p.updated_at,a.id,a.name,a.username,a.is_admin,e.id,e.name,e.username,e.is_admin,
COALESCE((SELECT json_agg(json_build_object('id',u.id,'name',u.name,'username',u.username,'isAdmin',u.is_admin) ORDER BY u.id) FROM project_collaborators c JOIN users u ON u.id=c.user_id WHERE c.project_id=p.id),'[]'::json)`
const projectJoins = ` FROM projects p JOIN users a ON a.id=p.author_id JOIN users e ON e.id=p.last_editor_id `

type scanner interface{ Scan(...any) error }

func scanProject(row scanner) (types.Project, error) {
	var p types.Project
	var created, updated time.Time
	var users []byte
	err := row.Scan(&p.Id, &p.Version, &p.Name, &p.Summary, &p.Readme, &p.Category, &p.DemoEnabled, &created, &updated, &p.Author.Id, &p.Author.Name, &p.Author.Username, &p.Author.IsAdmin, &p.LastEditor.Id, &p.LastEditor.Name, &p.LastEditor.Username, &p.LastEditor.IsAdmin, &users)
	if err != nil {
		return p, err
	}
	p.CreatedAt = created.UTC().Format(time.RFC3339)
	p.UpdatedAt = updated.UTC().Format(time.RFC3339)
	err = json.Unmarshal(users, &p.Collaborators)
	return p, err
}

var (
	ErrProjectConflict        = errors.New("project version conflict")
	ErrCollaboratorPermission = errors.New("only the author may change collaborators")
)

func canonicalCollaboratorIDs(ids []int64, author int64) []int64 {
	set := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		if id > 0 && id != author {
			set[id] = struct{}{}
		}
	}
	result := make([]int64, 0, len(set))
	for id := range set {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func sameIDs(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func (s *Store) UpdateProject(ctx context.Context, req *types.UpdateProjectRequest, editor int64, isAdmin bool) (types.Project, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return types.Project{}, err
	}
	defer tx.Rollback()

	var author, currentVersion int64
	var current projectSnapshot
	if err = tx.QueryRowContext(ctx, `SELECT author_id,version,name,summary,readme,category,demo_enabled FROM projects WHERE id=$1 FOR UPDATE`, req.Id).Scan(&author, &currentVersion, &current.Name, &current.Summary, &current.Readme, &current.Category, &current.DemoEnabled); err != nil {
		return types.Project{}, err
	}
	if currentVersion != req.Version {
		return types.Project{}, ErrProjectConflict
	}

	currentIDs, err := collaboratorIDs(ctx, tx, req.Id)
	if err != nil {
		return types.Project{}, err
	}

	requestedIDs := canonicalCollaboratorIDs(req.CollaboratorIds, author)
	if editor != author && !isAdmin && !sameIDs(currentIDs, requestedIDs) {
		return types.Project{}, ErrCollaboratorPermission
	}
	effectiveIDs := currentIDs
	if editor == author || isAdmin {
		effectiveIDs = requestedIDs
		if _, err = tx.ExecContext(ctx, `DELETE FROM project_collaborators WHERE project_id=$1`, req.Id); err != nil {
			return types.Project{}, err
		}
		for _, id := range requestedIDs {
			if _, err = tx.ExecContext(ctx, `INSERT INTO project_collaborators(project_id,user_id) VALUES($1,$2)`, req.Id, id); err != nil {
				return types.Project{}, err
			}
		}
	}

	result, err := tx.ExecContext(ctx, `UPDATE projects SET name=$1,summary=$2,readme=$3,category=$4,demo_enabled=$5,last_editor_id=$6,updated_at=now(),version=version+1 WHERE id=$7 AND version=$8`, req.Name, req.Summary, req.Readme, req.Category, req.DemoEnabled, editor, req.Id, req.Version)
	if err != nil {
		return types.Project{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return types.Project{}, err
	}
	if affected != 1 {
		return types.Project{}, ErrProjectConflict
	}
	next := projectSnapshot{Name: req.Name, Summary: req.Summary, Readme: req.Readme, Category: req.Category, DemoEnabled: req.DemoEnabled}
	changes := changedProjectFields(current, next, currentIDs, effectiveIDs)
	if err = insertProjectVersion(ctx, tx, req.Id, currentVersion+1, editor, next, effectiveIDs, "edit", changes, 0); err != nil {
		return types.Project{}, err
	}
	if err = tx.Commit(); err != nil {
		return types.Project{}, err
	}
	return s.Project(ctx, req.Id)
}
func (s *Store) Project(ctx context.Context, id int64) (types.Project, error) {
	return scanProject(s.DB.QueryRowContext(ctx, `SELECT `+projectColumns+projectJoins+` WHERE p.id=$1`, id))
}
func (s *Store) Projects(ctx context.Context, req *types.ListProjectsRequest, uid int64) (*types.ProjectsResponse, error) {
	filter := ` WHERE (strpos(lower(p.name),lower($1))>0 OR strpos(lower(p.summary),lower($1))>0) AND ($2='' OR p.category=$2) AND ($3='all' OR p.author_id=$4 OR EXISTS(SELECT 1 FROM project_collaborators c WHERE c.project_id=p.id AND c.user_id=$4))`
	result := &types.ProjectsResponse{Items: []types.Project{}}
	// A read-only snapshot keeps the count and page consistent during concurrent creation.
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	args := []any{req.Query, req.Category, req.Scope, uid}
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM projects p`+filter, args...).Scan(&result.Total); err != nil {
		return nil, err
	}
	order := "p.updated_at"
	if req.Sort == "created" {
		order = "p.created_at"
	}
	args = append(args, (req.Page-1)*20)
	rows, err := tx.QueryContext(ctx, `SELECT `+projectColumns+projectJoins+filter+` ORDER BY `+order+` DESC,p.id DESC LIMIT 20 OFFSET $5`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		result.Items = append(result.Items, p)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	return result, tx.Commit()
}
