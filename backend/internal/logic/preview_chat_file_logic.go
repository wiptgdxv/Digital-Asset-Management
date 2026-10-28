// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"digital-assets/backend/internal/files"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type PreviewChatFileLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewPreviewChatFileLogic(ctx context.Context, svcCtx *svc.ServiceContext) *PreviewChatFileLogic {
	return &PreviewChatFileLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *PreviewChatFileLogic) PreviewChatFile(req *types.UploadIDRequest) (*files.Download, error) {
	return l.svcCtx.ChatFiles.Open(l.ctx, req.Id, true)
}
