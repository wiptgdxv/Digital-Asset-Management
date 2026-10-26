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

type DownloadProjectFilesLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewDownloadProjectFilesLogic(ctx context.Context, svcCtx *svc.ServiceContext) *DownloadProjectFilesLogic {
	return &DownloadProjectFilesLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *DownloadProjectFilesLogic) DownloadProjectFiles(req *types.ProjectIDRequest) (*files.Archive, error) {
	return l.svcCtx.Files.OpenProjectArchive(l.ctx, req.Id)
}
