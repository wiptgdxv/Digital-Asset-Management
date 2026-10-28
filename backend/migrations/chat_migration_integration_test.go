package migrations

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func TestChatMigrationBackfillsExistingProjectsIntegration(t *testing.T) {
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
	schema := fmt.Sprintf("chat_migration_test_%x", time.Now().UnixNano())
	if _, err = admin.ExecContext(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.ExecContext(ctx, `DROP SCHEMA `+schema+` CASCADE`); err != nil {
			t.Errorf("cleanup schema: %v", err)
		}
	})
	config.RuntimeParams["search_path"] = schema
	db := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = db.Close() })
	if _, err = db.ExecContext(ctx, `CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		t.Fatal(err)
	}
	entries, err := files.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".sql") || entry.Name() >= "015_chat.sql" {
			continue
		}
		data, err := files.ReadFile(entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.ExecContext(ctx, string(data)); err != nil {
			t.Fatalf("%s: %v", entry.Name(), err)
		}
		if _, err = db.ExecContext(ctx, `INSERT INTO schema_migrations(version) VALUES($1)`, entry.Name()); err != nil {
			t.Fatal(err)
		}
	}
	var owner, member, outsider, project int64
	for _, item := range []struct {
		name string
		id   *int64
	}{{"owner", &owner}, {"member", &member}, {"outsider", &outsider}} {
		if err = db.QueryRowContext(ctx, `INSERT INTO users(name,username,password_hash) VALUES($1,$1,'test') RETURNING id`, item.name).Scan(item.id); err != nil {
			t.Fatal(err)
		}
	}
	if err = db.QueryRowContext(ctx, `INSERT INTO projects(name,summary,readme,category,author_id,last_editor_id) VALUES('existing','keep','original','其他',$1,$1) RETURNING id`, owner).Scan(&project); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `INSERT INTO project_collaborators(project_id,user_id) VALUES($1,$2)`, project, member); err != nil {
		t.Fatal(err)
	}
	if err = Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err = Apply(ctx, db); err != nil {
		t.Fatalf("migration not idempotent: %v", err)
	}
	var conversation int64
	if err = db.QueryRowContext(ctx, `SELECT id FROM chat_conversations WHERE project_id=$1 AND kind='project'`, project).Scan(&conversation); err != nil {
		t.Fatal(err)
	}
	var members int
	if err = db.QueryRowContext(ctx, `SELECT count(*) FROM chat_memberships WHERE conversation_id=$1 AND user_id IN ($2,$3) AND left_at IS NULL`, conversation, owner, member).Scan(&members); err != nil || members != 2 {
		t.Fatalf("backfilled members: %d %v", members, err)
	}
	var outsiderMember bool
	if err = db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chat_memberships WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL)`, conversation, outsider).Scan(&outsiderMember); err != nil || outsiderMember {
		t.Fatalf("outsider included: %v %v", outsiderMember, err)
	}
	var summary, readme string
	if err = db.QueryRowContext(ctx, `SELECT summary,readme FROM projects WHERE id=$1`, project).Scan(&summary, &readme); err != nil || summary != "keep" || readme != "original" {
		t.Fatalf("existing project changed: %q %q %v", summary, readme, err)
	}
}
