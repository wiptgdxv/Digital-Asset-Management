// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package main

import (
	"context"
	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/middleware"
	"flag"
	"fmt"
	"github.com/zeromicro/go-zero/core/logx"
	"net/http"
	"time"

	"digital-assets/backend/internal/config"
	"digital-assets/backend/internal/handler"
	"digital-assets/backend/internal/svc"

	"github.com/zeromicro/go-zero/core/conf"
	"github.com/zeromicro/go-zero/rest"
	"github.com/zeromicro/go-zero/rest/httpx"
)

var configFile = flag.String("f", "etc/asset-api.yaml", "the config file")

func main() {
	flag.Parse()

	var c config.Config
	conf.MustLoad(*configFile, &c, conf.UseEnv())
	httpx.SetErrorHandlerCtx(apperror.Handler)

	server := rest.MustNewServer(c.RestConf)
	server.Use(middleware.Origin(c.AllowedOrigin))
	defer server.Stop()

	ctx := svc.NewServiceContext(c)
	defer ctx.DB.Close()
	handler.RegisterHandlers(server, ctx)
	// tus is a standard streaming protocol, mounted separately from generated JSON handlers.
	server.AddRoutes(rest.WithMiddlewares([]rest.Middleware{ctx.Session}, []rest.Route{
		{Method: http.MethodPost, Path: "/api/v1/uploads", Handler: ctx.Files.Transport},
		{Method: http.MethodHead, Path: "/api/v1/uploads/:id", Handler: ctx.Files.Transport},
		{Method: http.MethodPatch, Path: "/api/v1/uploads/:id", Handler: ctx.Files.Transport},
	}...), rest.WithMaxBytes(16*1024*1024), rest.WithTimeout(0))
	cleanupCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-cleanupCtx.Done():
				return
			case <-ticker.C:
				if err := ctx.Files.Cleanup(cleanupCtx); err != nil {
					logx.Error("file cleanup deferred; will retry")
				}
			}
		}
	}()

	fmt.Printf("Starting server at %s:%d...\n", c.Host, c.Port)
	server.Start()
}
