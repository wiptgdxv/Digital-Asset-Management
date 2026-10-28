// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"errors"
	"strings"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type ListChatMembersLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewListChatMembersLogic(ctx context.Context, svcCtx *svc.ServiceContext) *ListChatMembersLogic {
	return &ListChatMembersLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *ListChatMembersLogic) ListChatMembers(req *types.ChatMembersRequest) (resp *types.UsersResponse, err error) {
	user := auth.Current(l.ctx).User
	if len(req.Query) > 200 {
		return nil, apperror.New(400, "搜索内容过长")
	}
	items, err := l.svcCtx.Store.ChatMembers(l.ctx, req.Id, user.Id, auth.IsSuperAdmin(user, l.svcCtx.Config.BootstrapAdminUsername), strings.TrimSpace(req.Query))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "会话不存在或无权访问")
	}
	if err != nil {
		return nil, err
	}
	return &types.UsersResponse{Items: items}, nil
}
