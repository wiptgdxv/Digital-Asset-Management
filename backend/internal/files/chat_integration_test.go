package files

import (
	"bytes"
	"context"
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/model"
	"digital-assets/backend/internal/types"
	"digital-assets/backend/migrations"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func TestChatUploadPrivacyAndRecallIntegration(t *testing.T) {
	dsn := os.Getenv("CHAT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("CHAT_TEST_DATABASE_URL not set")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	admin := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = admin.Close() })
	schema := fmt.Sprintf("chat_file_test_%x", time.Now().UnixNano())
	if _, err = admin.ExecContext(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.ExecContext(ctx, `DROP SCHEMA `+schema+` CASCADE`); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	config.RuntimeParams["search_path"] = schema
	db := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = db.Close() })
	if err = migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	createUser := func(name string) types.User {
		var u types.User
		err := db.QueryRowContext(ctx, `INSERT INTO users(name,username,password_hash) VALUES($1,$1,'test') RETURNING id,name,username,is_admin`, name).Scan(&u.Id, &u.Name, &u.Username, &u.IsAdmin)
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	a, b, outsider := createUser("alice"), createUser("bob"), createUser("outsider")
	store := &model.Store{DB: db}
	conversation, err := store.ChatDirect(ctx, a.Id, b.Id)
	if err != nil {
		t.Fatal(err)
	}
	base, err := New(db, t.TempDir(), "http://localhost")
	if err != nil {
		t.Fatal(err)
	}
	manager, err := NewChat(base, "http://localhost", "admin")
	if err != nil {
		t.Fatal(err)
	}
	as := func(user types.User) context.Context {
		return context.WithValue(ctx, auth.Key{}, auth.Session{User: user})
	}
	metadata := func(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
	limitRequest := func(size int64) int {
		req := httptest.NewRequest(http.MethodPost, "http://localhost/api/v1/chat/uploads", nil).WithContext(as(a))
		req.Header.Set("Tus-Resumable", "1.0.0")
		req.Header.Set("Upload-Length", fmt.Sprint(size))
		req.Header.Set("Upload-Metadata", "conversationId "+metadata(fmt.Sprint(conversation.Id))+",filename "+metadata("limit.bin"))
		res := httptest.NewRecorder(); manager.Transport(res, req); return res.Code
	}
	if status := limitRequest(MaxSize); status != http.StatusCreated { t.Fatalf("5 GB upload reservation rejected: %d", status) }
	if status := limitRequest(MaxSize+1); status < 400 { t.Fatalf("oversized upload accepted: %d", status) }
	body := []byte("internal file")
	req := httptest.NewRequest(http.MethodPost, "http://localhost/api/v1/chat/uploads", nil).WithContext(as(a))
	req.Header.Set("Tus-Resumable", "1.0.0")
	req.Header.Set("Upload-Length", fmt.Sprint(len(body)))
	req.Header.Set("Upload-Metadata", "conversationId "+metadata(fmt.Sprint(conversation.Id))+",filename "+metadata("note.txt")+",relativePath "+metadata("docs"))
	res := httptest.NewRecorder()
	manager.Transport(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", res.Code, res.Body.String())
	}
	location := res.Header().Get("Location")
	key := location[strings.LastIndex(location, "/")+1:]
	req = httptest.NewRequest(http.MethodPatch, "http://localhost/api/v1/chat/uploads/"+key, bytes.NewReader(body)).WithContext(as(a))
	req.Header.Set("Tus-Resumable", "1.0.0")
	req.Header.Set("Upload-Offset", "0")
	req.Header.Set("Content-Type", "application/offset+octet-stream")
	res = httptest.NewRecorder()
	manager.Transport(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("patch: %d %s", res.Code, res.Body.String())
	}
	message, err := manager.Complete(as(a), key)
	if err != nil {
		t.Fatal(err)
	}
	if message.Filename != "note.txt" || message.RelativePath != "docs" {
		t.Fatalf("attachment metadata: %#v", message)
	}
	search, err := store.ChatFilteredMessages(ctx, conversation.Id, b.Id, false, 0, "note", true)
	if err != nil || len(search) != 1 || search[0].AttachmentId != key {
		t.Fatalf("chat file search: %#v %v", search, err)
	}
	file, err := manager.Open(as(b), key, false)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(file.File)
	_ = file.File.Close()
	if err != nil || !bytes.Equal(data, body) {
		t.Fatalf("body: %q %v", data, err)
	}
	if _, err = manager.Open(as(outsider), key, false); err == nil {
		t.Fatal("outsider can download private file")
	}
	if err = store.ChatRecall(ctx, message.Id, a.Id, false); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Open(as(b), key, false); err == nil {
		t.Fatal("recalled file remains downloadable")
	}
	var queued bool
	if err = db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM file_cleanup WHERE upload_id=$1)`, key).Scan(&queued); err != nil || !queued {
		t.Fatalf("cleanup not queued: %v %v", queued, err)
	}
	if err = base.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(base.Root + string(os.PathSeparator) + key); !os.IsNotExist(err) {
		t.Fatalf("file not removed: %v", err)
	}
}
