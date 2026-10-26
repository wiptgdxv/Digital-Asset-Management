// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type ListProjectsLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewListProjectsLogic(ctx context.Context, svcCtx *svc.ServiceContext) *ListProjectsLogic {
	return &ListProjectsLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *ListProjectsLogic) ListProjects(req *types.ListProjectsRequest) (resp *types.ProjectsResponse, err error) {
	if req.Page < 1 || req.Page > 100000 || len(req.Query) > 200 || (req.Scope != "all" && req.Scope != "mine") || (req.Sort != "updated" && req.Sort != "created") || (req.Category != "" && !validCategory(req.Category)) {
		return nil, apperror.New(400, "无效的筛选条件")
	}
	return l.svcCtx.Store.Projects(l.ctx, req, auth.Current(l.ctx).User.Id)
}
