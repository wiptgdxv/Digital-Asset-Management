// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package svc

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/chat"
	"digital-assets/backend/internal/config"
	"digital-assets/backend/internal/files"
	"digital-assets/backend/internal/middleware"
	"digital-assets/backend/internal/model"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/zeromicro/go-zero/rest"
)

type ServiceContext struct {
	Config    config.Config
	DB        *sql.DB
	Store     *model.Store
	Session   rest.Middleware
	Files     *files.Manager
	ChatFiles *files.ChatManager
	ChatHub   *chat.Hub
}

func NewServiceContext(c config.Config) *ServiceContext {
	db, err := sql.Open("pgx", c.DatabaseURL)
	if err != nil {
		panic("invalid database configuration")
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	store := &model.Store{DB: db}
	if err = store.BootstrapAdmin(context.Background(), c.BootstrapAdminUsername); err != nil {
		panic("cannot initialize administrator")
	}
	fileManager, err := files.New(db, c.UploadDir, c.AllowedOrigin)
	if err != nil {
		panic("cannot initialize file storage")
	}
	chatFileManager, err := files.NewChat(fileManager, c.AllowedOrigin, c.BootstrapAdminUsername)
	if err != nil {
		panic("cannot initialize chat file storage")
	}
	return &ServiceContext{
		Config:    c,
		DB:        db,
		Store:     store,
		Files:     fileManager,
		ChatFiles: chatFileManager,
		ChatHub:   chat.New(store, c.AllowedOrigin),
		Session:   middleware.NewSessionMiddleware(store).Handle,
	}
}
