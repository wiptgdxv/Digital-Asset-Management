// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"database/sql"
	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"errors"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type ReadChatConversationLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewReadChatConversationLogic(ctx context.Context, svcCtx *svc.ServiceContext) *ReadChatConversationLogic {
	return &ReadChatConversationLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *ReadChatConversationLogic) ReadChatConversation(req *types.ChatReadRequest) (resp *types.MessageResponse, err error) {
	if req.LastMessageId < 0 {
		return nil, apperror.New(400, "无效的消息编号")
	}
	user := auth.Current(l.ctx).User
	err = l.svcCtx.Store.ChatRead(l.ctx, req.Id, user.Id, auth.IsSuperAdmin(user, l.svcCtx.Config.BootstrapAdminUsername), req.LastMessageId)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "会话不存在或无权访问")
	}
	if err != nil {
		return nil, err
	}
	return &types.MessageResponse{Message: "已读"}, nil
}
