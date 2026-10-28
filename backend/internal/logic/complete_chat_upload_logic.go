// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type CompleteChatUploadLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewCompleteChatUploadLogic(ctx context.Context, svcCtx *svc.ServiceContext) *CompleteChatUploadLogic {
	return &CompleteChatUploadLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *CompleteChatUploadLogic) CompleteChatUpload(req *types.UploadIDRequest) (resp *types.ChatMessage, err error) {
	item, err := l.svcCtx.ChatFiles.Complete(l.ctx, req.Id)
	if err != nil {
		return nil, err
	}
	l.svcCtx.ChatHub.Notify()
	return item, nil
}
