package model

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/types"
	"digital-assets/backend/migrations"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

// CHAT_TEST_DATABASE_URL must point to a disposable test PostgreSQL instance.
// The test creates and removes its own randomly named schema, not public data.
func TestChatMembershipAndPrivacyIntegration(t *testing.T) {
	dsn := os.Getenv("CHAT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("CHAT_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	admin := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = admin.Close() })
	schema := fmt.Sprintf("chat_test_%x", time.Now().UnixNano())
	if _, err = admin.ExecContext(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.ExecContext(ctx, `DROP SCHEMA `+schema+` CASCADE`); err != nil {
			t.Errorf("cleanup test schema: %v", err)
		}
	})
	config.RuntimeParams["search_path"] = schema
	db := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = db.Close() })
	if err = migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	store := &Store{DB: db}
	createUser := func(name string) int64 {
		t.Helper()
		var id int64
		if err := db.QueryRowContext(ctx, `INSERT INTO users(name,username,password_hash) VALUES($1,$1,'test') RETURNING id`, name).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	owner, member, outsider := createUser("owner"), createUser("member"), createUser("outsider")
	req := &types.ProjectRequest{Name: "test", Category: "其他", CollaboratorIds: []int64{member}}
	project, err := store.CreateProject(ctx, req, owner)
	if err != nil {
		t.Fatal(err)
	}
	var conversation int64
	if err = db.QueryRowContext(ctx, `SELECT id FROM chat_conversations WHERE project_id=$1`, project).Scan(&conversation); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ChatSend(ctx, conversation, owner, false, "before removal", 0); err != nil {
		t.Fatal(err)
	}
	before, err := store.ChatMessages(ctx, conversation, member, false, 0)
	if err != nil || len(before) != 1 {
		t.Fatalf("member messages: %#v, %v", before, err)
	}
	conversations, err := store.ChatConversations(ctx, member, false)
	if err != nil {
		t.Fatal(err)
	}
	var projectUnread int64 = -1
	for _, item := range conversations {
		if item.Id == conversation {
			projectUnread = item.Unread
		}
	}
	if projectUnread != 1 {
		t.Fatalf("project unread = %d", projectUnread)
	}
	newMessage, err := store.ChatSend(ctx, conversation, owner, false, "arrived during read", 0)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.ChatRead(ctx, conversation, member, false, before[len(before)-1].Id); err != nil {
		t.Fatal(err)
	}
	conversations, err = store.ChatConversations(ctx, member, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range conversations {
		if item.Id == conversation && item.Unread != 1 {
			t.Fatalf("new message incorrectly marked read: %d", item.Unread)
		}
	}
	if err = store.ChatRead(ctx, conversation, member, false, newMessage.Id); err != nil {
		t.Fatal(err)
	}
	mentioned, err := store.ChatSend(ctx, conversation, owner, false, "请 @member 和 @outsider 查看", 0)
	if err != nil {
		t.Fatal(err)
	}
	conversations, err = store.ChatConversations(ctx, member, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range conversations {
		if item.Id == conversation && item.Mentions != 1 {
			t.Fatalf("mention count = %d", item.Mentions)
		}
	}
	var outsiderMentions int
	if err = db.QueryRowContext(ctx, `SELECT count(*) FROM chat_mentions WHERE message_id=$1 AND user_id=$2`, mentioned.Id, outsider).Scan(&outsiderMentions); err != nil || outsiderMentions != 0 {
		t.Fatalf("nonmember mention: %d %v", outsiderMentions, err)
	}
	if err = store.ChatRead(ctx, conversation, member, false, mentioned.Id); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ChatMessages(ctx, conversation, outsider, false, 0); err != sql.ErrNoRows {
		t.Fatalf("outsider should be denied: %v", err)
	}
	members, err := store.ChatMembers(ctx, conversation, member, false, "")
	if err != nil || len(members) != 2 {
		t.Fatalf("project member search: %#v %v", members, err)
	}
	for _, user := range members {
		if user.Id == outsider {
			t.Fatal("outsider exposed in project member search")
		}
	}
	if _, err = store.ChatMembers(ctx, conversation, outsider, false, ""); err != sql.ErrNoRows {
		t.Fatalf("outsider can search members: %v", err)
	}
	if _, err = store.ChatMessages(ctx, conversation, outsider, true, 0); err != nil {
		t.Fatalf("super admin project access: %v", err)
	}
	if _, err = db.ExecContext(ctx, `DELETE FROM project_collaborators WHERE project_id=$1 AND user_id=$2`, project, member); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ChatMessages(ctx, conversation, member, false, 0); err != sql.ErrNoRows {
		t.Fatalf("removed member should be denied: %v", err)
	}
	if _, err = store.ChatSend(ctx, conversation, owner, false, "while absent", 0); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `INSERT INTO project_collaborators(project_id,user_id) VALUES($1,$2)`, project, member); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ChatSend(ctx, conversation, owner, false, "after rejoin", 0); err != nil {
		t.Fatal(err)
	}
	after, err := store.ChatMessages(ctx, conversation, member, false, 0)
	if err != nil || len(after) != 1 || after[0].Content != "after rejoin" {
		t.Fatalf("rejoined visibility: %#v, %v", after, err)
	}
	if _, err = store.ChatSend(ctx, conversation, member, false, "cannot quote old", before[0].Id); err != sql.ErrNoRows {
		t.Fatalf("rejoined member quoted old message: %v", err)
	}
	if _, err = store.ChatSend(ctx, conversation, owner, false, "reply to old", before[0].Id); err != nil {
		t.Fatal(err)
	}
	visible, err := store.ChatMessages(ctx, conversation, member, false, 0)
	if err != nil || len(visible) != 2 || visible[1].ReplyTo != 0 {
		t.Fatalf("hidden quote leaked: %#v, %v", visible, err)
	}
	direct, err := store.ChatDirect(ctx, owner, member)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.ChatMessages(ctx, direct.Id, outsider, true, 0); err != sql.ErrNoRows {
		t.Fatalf("super admin cannot read private chat: %v", err)
	}
	message, err := store.ChatSend(ctx, direct.Id, owner, false, "private", 0)
	if err != nil {
		t.Fatal(err)
	}
	const uploadID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err = db.ExecContext(ctx, `INSERT INTO chat_uploads(id,conversation_id,user_id,message_id,filename,size,state) VALUES($1,$2,$3,$4,'test.txt',1,'complete')`, uploadID, direct.Id, owner, message.Id); err != nil {
		t.Fatal(err)
	}
	if err = store.ChatRecall(ctx, message.Id, member, false); err != sql.ErrNoRows {
		t.Fatalf("another user cannot recall: %v", err)
	}
	if err = store.ChatRecall(ctx, message.Id, owner, false); err != nil {
		t.Fatal(err)
	}
	var queued bool
	if err = db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM file_cleanup WHERE upload_id=$1)`, uploadID).Scan(&queued); err != nil || !queued {
		t.Fatalf("recalled attachment cleanup: %v, %v", queued, err)
	}
	items, err := store.ChatMessages(ctx, direct.Id, member, false, 0)
	if err != nil || len(items) != 1 || !items[0].Recalled || items[0].Content != "" {
		t.Fatalf("recall: %#v, %v", items, err)
	}
	if _, err = db.ExecContext(ctx, `UPDATE chat_messages SET created_at=clock_timestamp()-interval '2 months'`); err != nil {
		t.Fatal(err)
	}
	if err = store.PurgeExpiredChatMessages(ctx); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err = db.QueryRowContext(ctx, `SELECT count(*) FROM chat_messages`).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("retention cleanup: %d, %v", remaining, err)
	}
}
