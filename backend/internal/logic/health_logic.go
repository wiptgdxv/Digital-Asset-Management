// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"digital-assets/backend/internal/apperror"
	"time"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type HealthLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewHealthLogic(ctx context.Context, svcCtx *svc.ServiceContext) *HealthLogic {
	return &HealthLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *HealthLogic) Health() (resp *types.HealthResponse, err error) {
	ctx, cancel := context.WithTimeout(l.ctx, 2*time.Second)
	defer cancel()
	if err := l.svcCtx.DB.PingContext(ctx); err != nil {
		l.Error("database readiness check failed")
		return nil, apperror.New(503, "数据库暂时不可用")
	}
	return &types.HealthResponse{Status: "ok", Database: "ok"}, nil
}
