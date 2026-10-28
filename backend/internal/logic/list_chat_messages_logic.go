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

type ListChatMessagesLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewListChatMessagesLogic(ctx context.Context, svcCtx *svc.ServiceContext) *ListChatMessagesLogic {
	return &ListChatMessagesLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *ListChatMessagesLogic) ListChatMessages(req *types.ChatMessagesRequest) (resp *types.ChatMessagesResponse, err error) {
	user := auth.Current(l.ctx).User
	if len(req.Query) > 200 {
		return nil, apperror.New(400, "搜索内容过长")
	}
	items, err := l.svcCtx.Store.ChatFilteredMessages(l.ctx, req.Id, user.Id, auth.IsSuperAdmin(user, l.svcCtx.Config.BootstrapAdminUsername), req.Before, strings.TrimSpace(req.Query), req.FilesOnly)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "会话不存在或无权访问")
	}
	if err != nil {
		return nil, err
	}
	return &types.ChatMessagesResponse{Items: items}, nil
}
