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

type ReadNotificationsLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewReadNotificationsLogic(ctx context.Context, svcCtx *svc.ServiceContext) *ReadNotificationsLogic {
	return &ReadNotificationsLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *ReadNotificationsLogic) ReadNotifications() (resp *types.MessageResponse, err error) {
	if err := l.svcCtx.Store.ReadNotifications(l.ctx, auth.Current(l.ctx).User.Id); err != nil {
		return nil, err
	}
	return &types.MessageResponse{Message: "提醒已全部标记为已读"}, nil
}
