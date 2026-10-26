// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package svc

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/config"
	"digital-assets/backend/internal/files"
	"digital-assets/backend/internal/middleware"
	"digital-assets/backend/internal/model"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/zeromicro/go-zero/rest"
)

type ServiceContext struct {
	Config  config.Config
	DB      *sql.DB
	Store   *model.Store
	Session rest.Middleware
	Files   *files.Manager
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
	return &ServiceContext{
		Config:  c,
		DB:      db,
		Store:   store,
		Files:   fileManager,
		Session: middleware.NewSessionMiddleware(store).Handle,
	}
}
