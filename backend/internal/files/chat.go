package files

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/types"
	"errors"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tus/tusd/v2/pkg/filelocker"
	tus "github.com/tus/tusd/v2/pkg/handler"
)

// ChatManager uses the same file store but separate records and access checks.
type ChatManager struct {
	*Manager
	TusChat       *tus.Handler
	SuperUsername string
}

const chatPermission = `(c.kind='global' OR (c.kind='direct' AND ($2=c.direct_low OR $2=c.direct_high)) OR (c.kind='project' AND ($3 OR EXISTS (SELECT 1 FROM chat_memberships cm WHERE cm.conversation_id=c.id AND cm.user_id=$2 AND cm.left_at IS NULL))))`
const chatMessageVisible = `(c.kind<>'project' OR $3 OR m.created_at >= (SELECT cm.joined_at FROM chat_memberships cm WHERE cm.conversation_id=c.id AND cm.user_id=$2 AND cm.left_at IS NULL))`

var safeBatchID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

func NewChat(m *Manager, origin, superUsername string) (*ChatManager, error) {
	c := &ChatManager{Manager: m, SuperUsername: superUsername}
	composer := tus.NewStoreComposer()
	m.Store.UseIn(composer)
	filelocker.New(m.Root).UseIn(composer)
	h, err := tus.NewHandler(tus.Config{BasePath: strings.TrimRight(origin, "/") + "/api/v1/chat/uploads/", StoreComposer: composer, MaxSize: MaxSize, DisableDownload: true, DisableTermination: true, PreUploadCreateCallback: c.create})
	if err != nil {
		return nil, err
	}
	c.TusChat = h
	return c, nil
}

func (c *ChatManager) allowed(ctx context.Context, conversationID int64) (bool, error) {
	user := auth.Current(ctx).User
	var allowed bool
	err := c.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chat_conversations c WHERE c.id=$1 AND `+chatPermission+`)`, conversationID, user.Id, auth.IsSuperAdmin(user, c.SuperUsername)).Scan(&allowed)
	return allowed, err
}

func (c *ChatManager) create(event tus.HookEvent) (tus.HTTPResponse, tus.FileInfoChanges, error) {
	fail := func(message string) (tus.HTTPResponse, tus.FileInfoChanges, error) {
		return tus.HTTPResponse{}, tus.FileInfoChanges{}, tus.NewError("INVALID_UPLOAD", message, 400)
	}
	info := event.Upload
	user := auth.Current(event.Context).User
	id, err := strconv.ParseInt(info.MetaData["conversationId"], 10, 64)
	name := strings.TrimSpace(info.MetaData["filename"])
	relativePath, pathOK := normalizeRelativePath(info.MetaData["relativePath"])
	batch := info.MetaData["batchId"]
	batchTotal := 1
	if raw := info.MetaData["batchTotal"]; raw != "" {
		var batchErr error
		batchTotal, batchErr = strconv.Atoi(raw)
		if batchErr != nil {
			return fail("文件批次参数不正确")
		}
	}
	if err != nil || id < 1 || user.Id < 1 || name == "" || utf8.RuneCountInString(name) > 255 || strings.ContainsAny(name, "/\\\x00\r\n") || name == "." || name == ".." || !pathOK || (batch != "" && !safeBatchID.MatchString(batch)) || batchTotal < 1 || batchTotal > 10000 || (batchTotal > 1 && batch == "") || info.SizeIsDeferred || info.IsPartial || info.IsFinal || info.Size < 0 || info.Size > MaxSize {
		return fail("文件名、大小或会话参数不正确")
	}
	allowed, err := c.allowed(event.Context, id)
	if err != nil {
		return tus.HTTPResponse{}, tus.FileInfoChanges{}, tus.NewError("DATABASE_UNAVAILABLE", "暂时无法创建上传", 503)
	}
	if !allowed {
		return fail("会话不存在或无权上传")
	}
	key, err := auth.Token()
	if err != nil {
		return tus.HTTPResponse{}, tus.FileInfoChanges{}, err
	}
	_, err = c.DB.ExecContext(event.Context, `INSERT INTO chat_uploads(id,conversation_id,user_id,filename,relative_path,size,batch_id,batch_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, key, id, user.Id, name, relativePath, info.Size, batch, batchTotal)
	if err != nil {
		return tus.HTTPResponse{}, tus.FileInfoChanges{}, tus.NewError("DATABASE_UNAVAILABLE", "暂时无法创建上传", 503)
	}
	return tus.HTTPResponse{}, tus.FileInfoChanges{ID: key, MetaData: tus.MetaData{"filename": name}}, nil
}

func (c *ChatManager) Transport(w http.ResponseWriter, r *http.Request) {
	key := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/chat/uploads"), "/")
	if key != "" {
		if !safeID.MatchString(key) {
			http.Error(w, "上传不存在", 404)
			return
		}
		var owner, conversation int64
		var state string
		err := c.DB.QueryRowContext(r.Context(), `SELECT user_id,conversation_id,state FROM chat_uploads WHERE id=$1`, key).Scan(&owner, &conversation, &state)
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "上传不存在", 404)
			return
		}
		if err != nil {
			http.Error(w, "暂时无法读取上传", 503)
			return
		}
		allowed, err := c.allowed(r.Context(), conversation)
		if err != nil {
			http.Error(w, "暂时无法读取上传", 503)
			return
		}
		if owner != auth.Current(r.Context()).User.Id || !allowed {
			http.Error(w, "无权访问此上传", 403)
			return
		}
		if state == "complete" && r.Method == http.MethodHead {
			file, openErr := c.Open(r.Context(), key, false)
			if openErr != nil {
				http.Error(w, "文件不存在或无权访问", 404)
				return
			}
			_ = file.File.Close()
		} else if state != "pending" {
			http.Error(w, "上传已完成", 409)
			return
		}
	}
	http.StripPrefix("/api/v1/chat/uploads", c.TusChat).ServeHTTP(w, r)
}

func (c *ChatManager) Complete(ctx context.Context, key string) (*types.ChatMessage, error) {
	if !safeID.MatchString(key) {
		return nil, apperror.New(400, "无效的上传编号")
	}
	tx, err := c.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var uid, conversation, size, batchTotal int64
	var name, relativePath, state, batch string
	var messageID sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT user_id,conversation_id,filename,relative_path,size,state,message_id,batch_id,batch_total FROM chat_uploads WHERE id=$1 FOR UPDATE`, key).Scan(&uid, &conversation, &name, &relativePath, &size, &state, &messageID, &batch, &batchTotal)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "上传不存在")
	}
	if err != nil {
		return nil, err
	}
	user := auth.Current(ctx).User
	if uid != user.Id {
		return nil, apperror.New(403, "无权完成此上传")
	}
	// Hold the conversation and membership rows until commit so a concurrent
	// project deletion or member removal cannot complete between check and write.
	var kind string
	if err = tx.QueryRowContext(ctx, `SELECT kind FROM chat_conversations WHERE id=$1 FOR UPDATE`, conversation).Scan(&kind); errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "会话不存在")
	} else if err != nil {
		return nil, err
	}
	super := auth.IsSuperAdmin(user, c.SuperUsername)
	if kind == "project" && !super {
		var membership int64
		if err = tx.QueryRowContext(ctx, `SELECT id FROM chat_memberships WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL FOR SHARE`, conversation, user.Id).Scan(&membership); errors.Is(err, sql.ErrNoRows) {
			return nil, apperror.New(403, "已失去会话权限")
		} else if err != nil {
			return nil, err
		}
	} else {
		var allowed bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chat_conversations c WHERE c.id=$1 AND `+chatPermission+`)`, conversation, user.Id, super).Scan(&allowed); err != nil {
			return nil, err
		}
		if !allowed {
			return nil, apperror.New(403, "无权访问此会话")
		}
	}
	var at time.Time
	if state == "pending" {
		upload, e := c.Store.GetUpload(ctx, key)
		if e != nil {
			return nil, apperror.New(409, "上传尚未开始，请重新上传")
		}
		info, e := upload.GetInfo(ctx)
		if e != nil {
			return nil, e
		}
		if info.Offset != size || info.Size != size {
			return nil, apperror.New(409, "文件尚未上传完整")
		}
		stat, e := os.Stat(filepath.Join(c.Root, key))
		if e != nil {
			return nil, e
		}
		if stat.Size() != size {
			return nil, apperror.New(409, "文件大小校验失败")
		}
		var id int64
		if err = tx.QueryRowContext(ctx, `INSERT INTO chat_messages(conversation_id,author_id,content) VALUES($1,$2,'') RETURNING id,created_at`, conversation, uid).Scan(&id, &at); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE chat_uploads SET state='complete',message_id=$2 WHERE id=$1`, key, id); err != nil {
			return nil, err
		}
		messageID = sql.NullInt64{Int64: id, Valid: true}
	} else if messageID.Valid {
		if err = tx.QueryRowContext(ctx, `SELECT m.created_at FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id WHERE m.id=$1 AND m.recalled_at IS NULL AND m.created_at>clock_timestamp()-interval '1 month' AND `+chatPermission+` AND `+chatMessageVisible, messageID.Int64, user.Id, super).Scan(&at); errors.Is(err, sql.ErrNoRows) {
			return nil, apperror.New(404, "文件不存在或无权访问")
		} else if err != nil {
			return nil, err
		}
	} else {
		return nil, apperror.New(409, "上传状态异常")
	}
	batchCompleted := int64(1)
	if batch != "" {
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM chat_uploads f JOIN chat_messages m ON m.id=f.message_id JOIN chat_conversations c ON c.id=f.conversation_id WHERE c.id=$1 AND `+chatPermission+` AND `+chatMessageVisible+` AND f.batch_id=$4 AND f.user_id=$2 AND f.state='complete' AND m.recalled_at IS NULL AND m.created_at>clock_timestamp()-interval '1 month'`, conversation, user.Id, super, batch).Scan(&batchCompleted); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	_, previewable := previewMediaType(name)
	return &types.ChatMessage{Id: messageID.Int64, ConversationId: conversation, Author: user, CreatedAt: at.UTC().Format(time.RFC3339Nano), AttachmentId: key, Filename: name, RelativePath: relativePath, Size: size, Previewable: previewable, BatchId: batch, BatchTotal: batchTotal, BatchCompleted: batchCompleted}, nil
}

func (c *ChatManager) OpenFolder(ctx context.Context, conversationID int64, batch, folder string) (*Archive, error) {
	folder, valid := normalizeRelativePath(folder)
	if conversationID < 1 || !valid || folder == "" || !safeBatchID.MatchString(batch) {
		return nil, apperror.New(400, "文件夹参数无效")
	}
	user := auth.Current(ctx).User
	rows, err := c.DB.QueryContext(ctx, `SELECT f.id,f.filename,f.relative_path,m.created_at FROM chat_uploads f JOIN chat_messages m ON m.id=f.message_id JOIN chat_conversations c ON c.id=f.conversation_id
	WHERE c.id=$1 AND `+chatPermission+` AND `+chatMessageVisible+` AND f.batch_id=$4 AND (f.relative_path=$5 OR left(f.relative_path,length($5)+1)=$5||'/') AND f.state='complete' AND m.recalled_at IS NULL AND m.created_at>clock_timestamp()-interval '1 month' ORDER BY f.relative_path,f.filename,f.id`, conversationID, user.Id, auth.IsSuperAdmin(user, c.SuperUsername), batch, folder)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	archive := &Archive{Name: safeArchiveName(path.Base(folder)) + ".zip", Files: []ArchiveFile{}}
	for rows.Next() {
		var key, name, relative string
		var at time.Time
		if err = rows.Scan(&key, &name, &relative, &at); err != nil {
			archive.Close()
			return nil, err
		}
		if !safeID.MatchString(key) {
			archive.Close()
			return nil, apperror.New(500, "存储标识无效")
		}
		file, e := os.Open(filepath.Join(c.Root, key))
		if e != nil {
			archive.Close()
			return nil, apperror.New(503, "部分文件暂时无法读取")
		}
		suffix := strings.TrimPrefix(strings.TrimPrefix(relative, folder), "/")
		archive.Files = append(archive.Files, ArchiveFile{File: file, Name: path.Join(path.Base(folder), suffix, name), Updated: at})
	}
	if err = rows.Err(); err != nil {
		archive.Close()
		return nil, err
	}
	if len(archive.Files) == 0 {
		return nil, apperror.New(404, "文件夹不存在或无权访问")
	}
	return archive, nil
}

func (c *ChatManager) Open(ctx context.Context, key string, preview bool) (*Download, error) {
	if !safeID.MatchString(key) {
		return nil, apperror.New(404, "文件不存在")
	}
	user := auth.Current(ctx).User
	var name string
	var at time.Time
	err := c.DB.QueryRowContext(ctx, `SELECT f.filename,m.created_at FROM chat_uploads f JOIN chat_messages m ON m.id=f.message_id JOIN chat_conversations c ON c.id=f.conversation_id WHERE f.id=$1 AND f.state='complete' AND m.recalled_at IS NULL AND m.created_at>clock_timestamp()-interval '1 month' AND `+chatPermission+` AND `+chatMessageVisible, key, user.Id, auth.IsSuperAdmin(user, c.SuperUsername)).Scan(&name, &at)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "文件不存在或无权访问")
	}
	if err != nil {
		return nil, err
	}
	media := "application/octet-stream"
	if preview {
		var ok bool
		media, ok = previewMediaType(name)
		if !ok {
			return nil, apperror.New(415, "此格式不支持在线展示")
		}
	}
	file, err := os.Open(filepath.Join(c.Root, key))
	if err != nil {
		return nil, apperror.New(503, "文件暂时无法读取")
	}
	return &Download{File: file, Name: name, Updated: at, MediaType: media}, nil
}
