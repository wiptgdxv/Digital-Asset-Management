// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/apperror"
	"errors"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type GetProjectLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewGetProjectLogic(ctx context.Context, svcCtx *svc.ServiceContext) *GetProjectLogic {
	return &GetProjectLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *GetProjectLogic) GetProject(req *types.ProjectIDRequest) (resp *types.Project, err error) {
	if req.Id < 1 {
		return nil, apperror.New(400, "无效的项目编号")
	}
	p, e := l.svcCtx.Store.Project(l.ctx, req.Id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, apperror.New(404, "项目不存在")
	}
	return &p, e
}
