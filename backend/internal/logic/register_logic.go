// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"errors"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
	"strings"
	"unicode/utf8"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type RegisterLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewRegisterLogic(ctx context.Context, svcCtx *svc.ServiceContext) *RegisterLogic {
	return &RegisterLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *RegisterLogic) Register(req *types.RegisterRequest) (resp *types.MessageResponse, err error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Username = auth.NormalizeUsername(req.Username)
	if !auth.ValidUsername(req.Username) || utf8.RuneCountInString(req.Name) < 1 || utf8.RuneCountInString(req.Name) > 60 || len(req.Password) < 8 || len(req.Password) > 72 {
		return nil, apperror.New(400, "请输入姓名、3–32 位用户名和 8–72 字节的密码")
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if e != nil {
		return nil, e
	}
	e = l.svcCtx.Store.Register(l.ctx, req.Name, req.Username, string(hash), req.Username == auth.NormalizeUsername(l.svcCtx.Config.BootstrapAdminUsername))
	if e != nil {
		var pg *pgconn.PgError
		if errors.As(e, &pg) && pg.Code == "23505" {
			return nil, apperror.New(409, "该用户名已注册")
		}
		return nil, e
	}
	return &types.MessageResponse{Message: "注册成功，请登录"}, nil
}
