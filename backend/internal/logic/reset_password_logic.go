// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"database/sql"
	"errors"

	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
	"golang.org/x/crypto/bcrypt"
)

type ResetPasswordLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewResetPasswordLogic(ctx context.Context, svcCtx *svc.ServiceContext) *ResetPasswordLogic {
	return &ResetPasswordLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *ResetPasswordLogic) ResetPassword(req *types.ResetPasswordRequest) (resp *types.ResetPasswordResponse, err error) {
	if req.Id < 1 {
		return nil, apperror.New(400, "无效的用户编号")
	}
	admin := auth.Current(l.ctx).User
	if !admin.IsAdmin {
		return nil, apperror.New(403, "只有管理员可以重置密码")
	}
	if req.Id == admin.Id {
		return nil, apperror.New(400, "不能重置自己的密码，请使用修改密码")
	}
	target, err := l.svcCtx.Store.User(l.ctx, req.Id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "用户不存在")
	}
	if err != nil {
		return nil, err
	}
	if auth.IsSuperAdmin(target, l.svcCtx.Config.BootstrapAdminUsername) {
		return nil, apperror.New(403, "不能重置超级管理员密码")
	}
	temporaryPassword, err := auth.TemporaryPassword(18)
	if err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(temporaryPassword), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	if err = l.svcCtx.Store.ResetPassword(l.ctx, req.Id, admin.Id, string(hash)); errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "用户不存在")
	} else if err != nil {
		return nil, err
	}
	return &types.ResetPasswordResponse{TemporaryPassword: temporaryPassword}, nil
}
