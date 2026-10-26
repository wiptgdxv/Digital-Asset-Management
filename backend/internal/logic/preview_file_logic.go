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

type PreviewFileLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewPreviewFileLogic(ctx context.Context, svcCtx *svc.ServiceContext) *PreviewFileLogic {
	return &PreviewFileLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *PreviewFileLogic) PreviewFile(req *types.FileIDRequest) (*files.Download, error) {
	return l.svcCtx.Files.OpenPreview(l.ctx, req.Id)
}
