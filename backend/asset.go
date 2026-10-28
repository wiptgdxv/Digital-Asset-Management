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
	// go-zero's request logger may dump request bodies and session headers on
	// errors or in verbose mode. Chat and credentials must never enter logs.
	c.Middlewares.Log = false
	c.Verbose = false

	server := rest.MustNewServer(c.RestConf)
	server.Use(middleware.SafeRequestLog)
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
	server.AddRoutes(rest.WithMiddlewares([]rest.Middleware{ctx.Session}, []rest.Route{
		{Method: http.MethodGet, Path: "/api/v1/chat/events", Handler: ctx.ChatHub.ServeHTTP},
	}...), rest.WithTimeout(0))
	server.AddRoutes(rest.WithMiddlewares([]rest.Middleware{ctx.Session}, []rest.Route{
		{Method: http.MethodPost, Path: "/api/v1/chat/uploads", Handler: ctx.ChatFiles.Transport},
		{Method: http.MethodHead, Path: "/api/v1/chat/uploads/:id", Handler: ctx.ChatFiles.Transport},
		{Method: http.MethodPatch, Path: "/api/v1/chat/uploads/:id", Handler: ctx.ChatFiles.Transport},
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
	go func() {
		// Retry failures on the next tick; cleanup is also run once at startup.
		for {
			if err := ctx.Store.PurgeExpiredChatMessages(cleanupCtx); err != nil {
				logx.Error("expired chat cleanup deferred; will retry")
			}
			timer := time.NewTimer(15 * time.Minute)
			select {
			case <-cleanupCtx.Done():
				if !timer.Stop() {
					<-timer.C
				}
				return
			case <-timer.C:
			}
		}
	}()

	fmt.Printf("Starting server at %s:%d...\n", c.Host, c.Port)
	server.Start()
}
