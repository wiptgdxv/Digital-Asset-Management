// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"errors"
	"golang.org/x/crypto/bcrypt"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type LoginLogic struct {
	SessionToken string
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewLoginLogic(ctx context.Context, svcCtx *svc.ServiceContext) *LoginLogic {
	return &LoginLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *LoginLogic) Login(req *types.LoginRequest) (resp *types.AuthResponse, err error) {
	username := auth.NormalizeUsername(req.Username)
	if len(req.Password) < 8 || len(req.Password) > 72 || !auth.ValidUsername(username) {
		return nil, apperror.New(401, "用户名或密码不正确")
	}
	u, hash, mustChangePassword, e := l.svcCtx.Store.LoginUser(l.ctx, username)
	if errors.Is(e, sql.ErrNoRows) {
		bcrypt.CompareHashAndPassword([]byte("$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"), []byte(req.Password))
		return nil, apperror.New(401, "用户名或密码不正确")
	}
	if e != nil {
		return nil, e
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		return nil, apperror.New(401, "用户名或密码不正确")
	}
	token, e := auth.Token()
	if e != nil {
		return nil, e
	}
	csrf, e := auth.Token()
	if e != nil {
		return nil, e
	}
	if e = l.svcCtx.Store.CreateSession(l.ctx, auth.Hash(token), csrf, u.Id); e != nil {
		return nil, e
	}
	l.SessionToken = token
	return &types.AuthResponse{User: u, CsrfToken: csrf, MustChangePassword: mustChangePassword}, nil
}
