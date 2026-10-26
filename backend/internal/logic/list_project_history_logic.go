// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"database/sql"
	"errors"

	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type ListProjectHistoryLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewListProjectHistoryLogic(ctx context.Context, svcCtx *svc.ServiceContext) *ListProjectHistoryLogic {
	return &ListProjectHistoryLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *ListProjectHistoryLogic) ListProjectHistory(req *types.ListProjectHistoryRequest) (resp *types.ProjectHistoryResponse, err error) {
	if req.Id < 1 || req.Page < 1 || req.Page > 100000 {
		return nil, apperror.New(400, "请检查项目编号和页码")
	}
	result, err := l.svcCtx.Store.ProjectHistory(l.ctx, req.Id, req.Page)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "项目不存在")
	}
	return result, err
}
