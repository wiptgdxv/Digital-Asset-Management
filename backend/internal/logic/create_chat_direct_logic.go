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

type CreateChatDirectLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewCreateChatDirectLogic(ctx context.Context, svcCtx *svc.ServiceContext) *CreateChatDirectLogic {
	return &CreateChatDirectLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *CreateChatDirectLogic) CreateChatDirect(req *types.ChatDirectRequest) (resp *types.ChatConversation, err error) {
	item, err := l.svcCtx.Store.ChatDirect(l.ctx, auth.Current(l.ctx).User.Id, req.UserId)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "员工不存在或不能与自己私聊")
	}
	if err != nil {
		return nil, err
	}
	l.svcCtx.ChatHub.Notify()
	return &item, nil
}
