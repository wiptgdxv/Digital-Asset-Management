// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"digital-assets/backend/internal/auth"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type MeLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewMeLogic(ctx context.Context, svcCtx *svc.ServiceContext) *MeLogic {
	return &MeLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *MeLogic) Me() (resp *types.AuthResponse, err error) {
	s := auth.Current(l.ctx)
	return &types.AuthResponse{User: s.User, CsrfToken: s.Csrf, MustChangePassword: s.MustChangePassword, IsSuperAdmin: auth.IsSuperAdmin(s.User, l.svcCtx.Config.BootstrapAdminUsername)}, nil
}
