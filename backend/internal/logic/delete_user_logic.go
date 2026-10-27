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

type DeleteUserLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewDeleteUserLogic(ctx context.Context, svcCtx *svc.ServiceContext) *DeleteUserLogic {
	return &DeleteUserLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *DeleteUserLogic) DeleteUser(req *types.DeleteUserRequest) (resp *types.MessageResponse, err error) {
	if req.Id < 1 {
		return nil, apperror.New(400, "无效的用户编号")
	}
	current := auth.Current(l.ctx).User
	if !auth.IsSuperAdmin(current, l.svcCtx.Config.BootstrapAdminUsername) {
		return nil, apperror.New(403, "只有超级管理员可以删除账号")
	}
	if req.Id == current.Id {
		return nil, apperror.New(400, "不能删除自己的超级管理员账号")
	}
	err = l.svcCtx.Store.DeleteUser(l.ctx, req.Id, l.svcCtx.Config.BootstrapAdminUsername)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "用户不存在")
	}
	if errors.Is(err, model.ErrCannotDeleteSuperAdmin) {
		return nil, apperror.New(409, "不能删除超级管理员账号")
	}
	if err != nil {
		return nil, err
	}
	return &types.MessageResponse{Message: "账号已删除"}, nil
}
