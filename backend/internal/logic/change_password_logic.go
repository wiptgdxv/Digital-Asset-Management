// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"errors"

	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/model"
	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
	"golang.org/x/crypto/bcrypt"
)

type ChangePasswordLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewChangePasswordLogic(ctx context.Context, svcCtx *svc.ServiceContext) *ChangePasswordLogic {
	return &ChangePasswordLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *ChangePasswordLogic) ChangePassword(req *types.ChangePasswordRequest) (resp *types.MessageResponse, err error) {
	if len(req.CurrentPassword) < 8 || len(req.CurrentPassword) > 72 || len(req.NewPassword) < 8 || len(req.NewPassword) > 72 {
		return nil, apperror.New(400, "密码长度必须为 8–72 个字符")
	}
	if req.CurrentPassword == req.NewPassword {
		return nil, apperror.New(400, "新密码不能与当前密码相同")
	}
	session := auth.Current(l.ctx)
	currentHash, err := l.svcCtx.Store.PasswordHash(l.ctx, session.User.Id)
	if err != nil {
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(req.CurrentPassword)) != nil {
		return nil, apperror.New(400, "当前密码不正确")
	}
	nextHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	if err = l.svcCtx.Store.ChangePassword(l.ctx, session.User.Id, session.Hash, currentHash, string(nextHash)); errors.Is(err, model.ErrPasswordChanged) {
		return nil, apperror.New(409, "密码已发生变化，请重新登录")
	} else if err != nil {
		return nil, err
	}
	return &types.MessageResponse{Message: "密码已修改"}, nil
}
