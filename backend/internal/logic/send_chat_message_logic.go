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
	"unicode/utf8"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type SendChatMessageLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewSendChatMessageLogic(ctx context.Context, svcCtx *svc.ServiceContext) *SendChatMessageLogic {
	return &SendChatMessageLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *SendChatMessageLogic) SendChatMessage(req *types.ChatSendRequest) (resp *types.ChatMessage, err error) {
	content := strings.TrimSpace(req.Content)
	if utf8.RuneCountInString(content) < 1 || utf8.RuneCountInString(content) > 2000 {
		return nil, apperror.New(400, "消息不能为空，且不超过 2000 字")
	}
	user := auth.Current(l.ctx).User
	if req.ReplyTo < 0 {
		return nil, apperror.New(400, "无效的引用消息")
	}
	item, err := l.svcCtx.Store.ChatSend(l.ctx, req.Id, user.Id, auth.IsSuperAdmin(user, l.svcCtx.Config.BootstrapAdminUsername), content, req.ReplyTo)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "会话不存在或无权访问")
	}
	if err != nil {
		return nil, err
	}
	l.svcCtx.ChatHub.Notify()
	return &item, nil
}
