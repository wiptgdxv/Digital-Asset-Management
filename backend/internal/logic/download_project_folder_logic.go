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

type DownloadProjectFolderLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewDownloadProjectFolderLogic(ctx context.Context, svcCtx *svc.ServiceContext) *DownloadProjectFolderLogic {
	return &DownloadProjectFolderLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *DownloadProjectFolderLogic) DownloadProjectFolder(req *types.ProjectFolderRequest) (*files.Archive, error) {
	return l.svcCtx.Files.OpenProjectFolderArchive(l.ctx, req.Id, req.Folder)
}
