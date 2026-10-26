package files

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/types"
	"errors"
	"github.com/tus/tusd/v2/pkg/filelocker"
	"github.com/tus/tusd/v2/pkg/filestore"
	tus "github.com/tus/tusd/v2/pkg/handler"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxSize int64 = 5000000000

const (
	KindProject = "project"
	KindDemo    = "demo"
)

var safeID = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Manager struct {
	DB    *sql.DB
	Root  string
	Store filestore.FileStore
	Tus   *tus.Handler
}

func New(db *sql.DB, root string, origin string) (*Manager, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	m := &Manager{DB: db, Root: root, Store: filestore.New(root)}
	composer := tus.NewStoreComposer()
	m.Store.UseIn(composer)
	filelocker.New(root).UseIn(composer)
	h, err := tus.NewHandler(tus.Config{BasePath: strings.TrimRight(origin, "/") + "/api/v1/uploads/", StoreComposer: composer, MaxSize: MaxSize, DisableDownload: true, DisableTermination: true, PreUploadCreateCallback: m.create})
	if err != nil {
		return nil, err
	}
	m.Tus = h
	return m, nil
}
func (m *Manager) create(event tus.HookEvent) (tus.HTTPResponse, tus.FileInfoChanges, error) {
	fail := func(message string) (tus.HTTPResponse, tus.FileInfoChanges, error) {
		return tus.HTTPResponse{}, tus.FileInfoChanges{}, tus.NewError("INVALID_UPLOAD", message, 400)
	}
	info := event.Upload
	uid := auth.Current(event.Context).User.Id
	pid, err := strconv.ParseInt(info.MetaData["projectId"], 10, 64)
	name := strings.TrimSpace(info.MetaData["filename"])
	relativePath, pathOK := normalizeRelativePath(info.MetaData["relativePath"])
	kind := strings.TrimSpace(info.MetaData["kind"])
	if kind == "" {
		kind = KindProject
	}
	if err != nil || pid < 1 || uid < 1 || name == "" || utf8.RuneCountInString(name) > 255 || strings.ContainsAny(name, "/\\\x00\r\n") || name == "." || name == ".." || !pathOK || info.SizeIsDeferred || info.IsPartial || info.IsFinal || info.Size < 0 || info.Size > MaxSize {
		return fail("文件名、大小或项目参数不正确")
	}
	if kind != KindProject && kind != KindDemo {
		return fail("文件类型无效")
	}
	var demoEnabled bool
	if err = m.DB.QueryRowContext(event.Context, `SELECT demo_enabled FROM projects WHERE id=$1`, pid).Scan(&demoEnabled); errors.Is(err, sql.ErrNoRows) {
		return fail("项目不存在")
	} else if err != nil {
		return tus.HTTPResponse{}, tus.FileInfoChanges{}, tus.NewError("DATABASE_UNAVAILABLE", "暂时无法创建上传", 503)
	}
	if kind == KindDemo && !demoEnabled {
		return fail("此项目未启用演示材料")
	}
	if raw := info.MetaData["replaceId"]; raw != "" && raw != "0" {
		return fail("不再支持替换文件，请删除旧文件后重新添加")
	}
	id, err := auth.Token()
	if err != nil {
		return tus.HTTPResponse{}, tus.FileInfoChanges{}, err
	}
	_, err = m.DB.ExecContext(event.Context, `INSERT INTO upload_records(id,project_id,user_id,filename,relative_path,size,kind) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, pid, uid, name, relativePath, info.Size, kind)
	if err != nil {
		return tus.HTTPResponse{}, tus.FileInfoChanges{}, tus.NewError("DATABASE_UNAVAILABLE", "暂时无法创建上传", 503)
	}
	return tus.HTTPResponse{}, tus.FileInfoChanges{ID: id, MetaData: tus.MetaData{"filename": name}}, nil
}

func normalizeRelativePath(value string) (string, bool) {
	if value == "" {
		return "", true
	}
	if utf8.RuneCountInString(value) > 1000 || strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\\\x00\r\n") || path.Clean(value) != value {
		return "", false
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." || utf8.RuneCountInString(part) > 255 {
			return "", false
		}
	}
	return value, true
}
func (m *Manager) Transport(w http.ResponseWriter, r *http.Request) {
	// Every HEAD/PATCH is owner checked; opaque upload URLs are not authorization.
	id := strings.TrimPrefix(r.URL.Path, "/api/v1/uploads")
	id = strings.Trim(id, "/")
	if id != "" {
		if !safeID.MatchString(id) {
			http.Error(w, "无效的上传编号", 404)
			return
		}
		var owner int64
		var state string
		err := m.DB.QueryRowContext(r.Context(), `SELECT user_id,state FROM upload_records WHERE id=$1`, id).Scan(&owner, &state)
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "上传不存在", 404)
			return
		}
		if err != nil {
			http.Error(w, "暂时无法读取上传", 503)
			return
		}
		if owner != auth.Current(r.Context()).User.Id {
			http.Error(w, "无权访问此上传", 403)
			return
		}
		if state == "superseded" {
			http.Error(w, "文件已被替换", 410)
			return
		}
	}
	http.StripPrefix("/api/v1/uploads", m.Tus).ServeHTTP(w, r)
}
func (m *Manager) List(ctx context.Context, pid int64, kind string) (*types.FilesResponse, error) {
	if pid < 1 {
		return nil, apperror.New(400, "无效的项目编号")
	}
	if kind != KindProject && kind != KindDemo {
		return nil, apperror.New(400, "无效的文件类型")
	}
	var demoEnabled bool
	if err := m.DB.QueryRowContext(ctx, `SELECT demo_enabled FROM projects WHERE id=$1`, pid).Scan(&demoEnabled); errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "项目不存在")
	} else if err != nil {
		return nil, err
	}
	if kind == KindDemo && !demoEnabled {
		return nil, apperror.New(404, "此项目未启用演示材料")
	}
	rows, err := m.DB.QueryContext(ctx, `SELECT f.id,f.filename,f.relative_path,f.size,u.name,f.updated_at,f.kind FROM project_files f JOIN users u ON u.id=f.uploader_id WHERE f.project_id=$1 AND f.kind=$2 ORDER BY f.relative_path,f.filename,f.id`, pid, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &types.FilesResponse{Items: []types.FileItem{}}
	for rows.Next() {
		var f types.FileItem
		var at time.Time
		if err = rows.Scan(&f.Id, &f.Filename, &f.RelativePath, &f.Size, &f.Uploader, &at, &f.Kind); err != nil {
			return nil, err
		}
		f.UpdatedAt = at.UTC().Format(time.RFC3339)
		_, f.Previewable = previewMediaType(f.Filename)
		out.Items = append(out.Items, f)
	}
	return out, rows.Err()
}
func (m *Manager) Complete(ctx context.Context, id string) (*types.FileItem, error) {
	if !safeID.MatchString(id) {
		return nil, apperror.New(400, "无效的上传编号")
	}
	tx, err := m.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var uid, pid, size, replace int64
	var name, relativePath, state, kind string
	err = tx.QueryRowContext(ctx, `SELECT user_id,project_id,filename,relative_path,size,replace_id,state,kind FROM upload_records WHERE id=$1 FOR UPDATE`, id).Scan(&uid, &pid, &name, &relativePath, &size, &replace, &state, &kind)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "上传不存在")
	}
	if err != nil {
		return nil, err
	}
	if uid != auth.Current(ctx).User.Id {
		return nil, apperror.New(403, "无权完成此上传")
	}
	if state == "superseded" {
		return nil, apperror.New(409, "附件已被其他版本替换")
	}
	if replace != 0 {
		return nil, apperror.New(409, "不再支持替换文件，请删除旧文件后重新添加")
	}
	if state == "pending" {
		if kind == KindDemo {
			var demoEnabled bool
			if err = tx.QueryRowContext(ctx, `SELECT demo_enabled FROM projects WHERE id=$1 FOR UPDATE`, pid).Scan(&demoEnabled); errors.Is(err, sql.ErrNoRows) {
				return nil, apperror.New(404, "项目不存在")
			} else if err != nil {
				return nil, err
			}
			if !demoEnabled {
				return nil, apperror.New(409, "此项目已关闭演示材料，请重新启用后再完成上传")
			}
		}
		upload, err := m.Store.GetUpload(ctx, id)
		if err != nil {
			return nil, apperror.New(409, "上传尚未开始，请重新上传")
		}
		info, err := upload.GetInfo(ctx)
		if err != nil {
			return nil, err
		}
		if info.Offset != size || info.Size != size {
			return nil, apperror.New(409, "文件尚未上传完整")
		}
		stat, err := os.Stat(filepath.Join(m.Root, id))
		if err != nil {
			return nil, err
		}
		if stat.Size() != size {
			return nil, apperror.New(409, "文件大小校验失败")
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO project_files(project_id,upload_id,filename,relative_path,size,uploader_id,kind) VALUES($1,$2,$3,$4,$5,$6,$7)`, pid, id, name, relativePath, size, uid, kind); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE upload_records SET state='complete' WHERE id=$1`, id); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE projects SET updated_at=now(),last_editor_id=$1 WHERE id=$2`, uid, pid); err != nil {
			return nil, err
		}
	}
	var out types.FileItem
	var at time.Time
	err = tx.QueryRowContext(ctx, `SELECT f.id,f.filename,f.relative_path,f.size,u.name,f.updated_at,f.kind FROM project_files f JOIN users u ON u.id=f.uploader_id WHERE f.upload_id=$1`, id).Scan(&out.Id, &out.Filename, &out.RelativePath, &out.Size, &out.Uploader, &at, &out.Kind)
	if err != nil {
		return nil, err
	}
	out.UpdatedAt = at.UTC().Format(time.RFC3339)
	_, out.Previewable = previewMediaType(out.Filename)
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &out, nil
}

func (m *Manager) Delete(ctx context.Context, id int64) error {
	if id < 1 {
		return apperror.New(400, "无效的文件编号")
	}
	tx, err := m.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var uploadID string
	var projectID int64
	err = tx.QueryRowContext(ctx, `SELECT upload_id,project_id FROM project_files WHERE id=$1 FOR UPDATE`, id).Scan(&uploadID, &projectID)
	if errors.Is(err, sql.ErrNoRows) {
		return apperror.New(404, "文件不存在")
	}
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM project_files WHERE id=$1`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM upload_records WHERE id=$1`, uploadID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE projects SET updated_at=now(),last_editor_id=$1 WHERE id=$2`, auth.Current(ctx).User.Id, projectID); err != nil {
		return err
	}
	return tx.Commit()
}

type Download struct {
	File      *os.File
	Name      string
	Updated   time.Time
	MediaType string
}

type ArchiveFile struct {
	File    *os.File
	Name    string
	Updated time.Time
}

type Archive struct {
	Name  string
	Files []ArchiveFile
}

func (a *Archive) Close() {
	for i := range a.Files {
		_ = a.Files[i].File.Close()
	}
}

func (m *Manager) OpenProjectArchive(ctx context.Context, pid int64) (*Archive, error) {
	return m.openProjectArchive(ctx, pid, "")
}

func (m *Manager) OpenProjectFolderArchive(ctx context.Context, pid int64, folder string) (*Archive, error) {
	folder = strings.TrimSpace(folder)
	normalized, ok := normalizeRelativePath(folder)
	if !ok || normalized == "" {
		return nil, apperror.New(400, "文件夹路径无效")
	}
	return m.openProjectArchive(ctx, pid, normalized)
}

func (m *Manager) openProjectArchive(ctx context.Context, pid int64, folder string) (*Archive, error) {
	if pid < 1 {
		return nil, apperror.New(400, "无效的项目编号")
	}
	var projectName string
	if err := m.DB.QueryRowContext(ctx, `SELECT name FROM projects WHERE id=$1`, pid).Scan(&projectName); errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "项目不存在")
	} else if err != nil {
		return nil, err
	}
	type record struct {
		key     string
		name    string
		path    string
		updated time.Time
	}
	rows, err := m.DB.QueryContext(ctx, `
		SELECT upload_id,filename,relative_path,updated_at
		FROM project_files
		WHERE project_id=$1 AND kind=$2
		  AND ($3='' OR relative_path=$3 OR left(relative_path,length($3)+1)=$3 || '/')
		ORDER BY relative_path,filename,id`, pid, KindProject, folder)
	if err != nil {
		return nil, err
	}
	records := []record{}
	for rows.Next() {
		var item record
		if err = rows.Scan(&item.key, &item.name, &item.path, &item.updated); err != nil {
			rows.Close()
			return nil, err
		}
		records = append(records, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		if folder != "" {
			return nil, apperror.New(404, "文件夹不存在或暂无可下载文件")
		}
		return nil, apperror.New(404, "项目暂无可下载文件")
	}
	archiveName := safeArchiveName(projectName) + "-项目文件.zip"
	if folder != "" {
		archiveName = safeArchiveName(path.Base(folder)) + ".zip"
	}
	archive := &Archive{Name: archiveName, Files: make([]ArchiveFile, 0, len(records))}
	for _, item := range records {
		if !safeID.MatchString(item.key) {
			archive.Close()
			return nil, apperror.New(500, "存储标识无效")
		}
		file, openErr := os.Open(filepath.Join(m.Root, item.key))
		if openErr != nil {
			archive.Close()
			return nil, apperror.New(503, "部分文件暂时无法读取，请稍后重试")
		}
		entryName := path.Join(item.path, item.name)
		if folder != "" {
			relative := strings.TrimPrefix(item.path, folder)
			relative = strings.TrimPrefix(relative, "/")
			entryName = path.Join(path.Base(folder), relative, item.name)
		}
		archive.Files = append(archive.Files, ArchiveFile{File: file, Name: entryName, Updated: item.updated})
	}
	return archive, nil
}

func safeArchiveName(name string) string {
	name = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`\\/:*?"<>|`, r) {
			return '_'
		}
		return r
	}, strings.TrimSpace(name))
	if name == "" {
		return "项目"
	}
	return name
}

func (m *Manager) Open(ctx context.Context, id int64) (*Download, error) {
	var key, name string
	var updated time.Time
	err := m.DB.QueryRowContext(ctx, `SELECT upload_id,filename,updated_at FROM project_files WHERE id=$1 AND kind=$2`, id, KindProject).Scan(&key, &name, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "文件不存在")
	}
	if err != nil {
		return nil, err
	}
	if !safeID.MatchString(key) {
		return nil, apperror.New(500, "存储标识无效")
	}
	file, err := os.Open(filepath.Join(m.Root, key))
	if err != nil {
		return nil, apperror.New(503, "文件暂时无法读取")
	}
	return &Download{File: file, Name: name, Updated: updated}, nil
}

func (m *Manager) OpenPreview(ctx context.Context, id int64) (*Download, error) {
	var key, name string
	var updated time.Time
	err := m.DB.QueryRowContext(ctx, `SELECT upload_id,filename,updated_at FROM project_files WHERE id=$1 AND kind=$2`, id, KindDemo).Scan(&key, &name, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "演示材料不存在")
	}
	if err != nil {
		return nil, err
	}
	mediaType, ok := previewMediaType(name)
	if !ok {
		return nil, apperror.New(415, "此格式不支持在线展示")
	}
	if !safeID.MatchString(key) {
		return nil, apperror.New(500, "存储标识无效")
	}
	file, err := os.Open(filepath.Join(m.Root, key))
	if err != nil {
		return nil, apperror.New(503, "文件暂时无法读取")
	}
	return &Download{File: file, Name: name, Updated: updated, MediaType: mediaType}, nil
}

func previewMediaType(name string) (string, bool) {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg":
		return "image/jpeg", true
	case ".png":
		return "image/png", true
	case ".gif":
		return "image/gif", true
	case ".webp":
		return "image/webp", true
	case ".pdf":
		return "application/pdf", true
	case ".mp4":
		return "video/mp4", true
	default:
		return "", false
	}
}

// Only delete UUID-named files explicitly enqueued by a committed replacement.
func (m *Manager) Cleanup(ctx context.Context) error {
	rows, err := m.DB.QueryContext(ctx, `SELECT upload_id FROM file_cleanup LIMIT 100`)
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range ids {
		if !safeID.MatchString(id) {
			continue
		}
		ok := true
		for _, suffix := range []string{"", ".info"} {
			err = os.Remove(filepath.Join(m.Root, id+suffix))
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				ok = false
			}
		}
		if ok {
			if _, err = m.DB.ExecContext(ctx, `DELETE FROM file_cleanup WHERE upload_id=$1`, id); err != nil {
				return err
			}
		}
	}
	return nil
}
