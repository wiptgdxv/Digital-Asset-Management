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

type UpdateAdminLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewUpdateAdminLogic(ctx context.Context, svcCtx *svc.ServiceContext) *UpdateAdminLogic {
	return &UpdateAdminLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *UpdateAdminLogic) UpdateAdmin(req *types.UpdateAdminRequest) (resp *types.User, err error) {
	if req.Id < 1 {
		return nil, apperror.New(400, "无效的用户编号")
	}
	if !auth.Current(l.ctx).User.IsAdmin {
		return nil, apperror.New(403, "只有管理员可以调整管理员权限")
	}
	user, err := l.svcCtx.Store.SetAdmin(l.ctx, req.Id, req.IsAdmin)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "用户不存在")
	}
	if errors.Is(err, model.ErrLastAdmin) {
		return nil, apperror.New(409, "必须至少保留一名管理员")
	}
	return &user, err
}
