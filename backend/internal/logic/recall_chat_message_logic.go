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

type RecallChatMessageLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewRecallChatMessageLogic(ctx context.Context, svcCtx *svc.ServiceContext) *RecallChatMessageLogic {
	return &RecallChatMessageLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *RecallChatMessageLogic) RecallChatMessage(req *types.ChatIdRequest) (resp *types.MessageResponse, err error) {
	user := auth.Current(l.ctx).User
	err = l.svcCtx.Store.ChatRecall(l.ctx, req.Id, user.Id, auth.IsSuperAdmin(user, l.svcCtx.Config.BootstrapAdminUsername))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "消息不存在或无权撤回")
	}
	if err != nil {
		return nil, err
	}
	l.svcCtx.ChatHub.Notify()
	return &types.MessageResponse{Message: "消息已撤回"}, nil
}
