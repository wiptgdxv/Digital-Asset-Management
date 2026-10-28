// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"database/sql"
	"errors"

	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/model"
	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type DeleteProjectLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewDeleteProjectLogic(ctx context.Context, svcCtx *svc.ServiceContext) *DeleteProjectLogic {
	return &DeleteProjectLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *DeleteProjectLogic) DeleteProject(req *types.ProjectIDRequest) (resp *types.MessageResponse, err error) {
	if req.Id < 1 {
		return nil, apperror.New(400, "无效的项目编号")
	}
	user := auth.Current(l.ctx).User
	err = l.svcCtx.Store.DeleteProject(l.ctx, req.Id, user.Id, user.IsAdmin)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "项目不存在")
	}
	if errors.Is(err, model.ErrProjectPermission) {
		return nil, apperror.New(403, "只有项目作者或管理员可以删除项目")
	}
	if err != nil {
		return nil, err
	}
	l.svcCtx.ChatHub.Notify()
	return &types.MessageResponse{Message: "项目已删除，附件正在安全清理"}, nil
}
