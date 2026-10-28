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

type ListChatConversationsLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewListChatConversationsLogic(ctx context.Context, svcCtx *svc.ServiceContext) *ListChatConversationsLogic {
	return &ListChatConversationsLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *ListChatConversationsLogic) ListChatConversations() (resp *types.ChatConversationsResponse, err error) {
	user := auth.Current(l.ctx).User
	items, err := l.svcCtx.Store.ChatConversations(l.ctx, user.Id, auth.IsSuperAdmin(user, l.svcCtx.Config.BootstrapAdminUsername))
	if err != nil {
		return nil, err
	}
	return &types.ChatConversationsResponse{Items: items}, nil
}
