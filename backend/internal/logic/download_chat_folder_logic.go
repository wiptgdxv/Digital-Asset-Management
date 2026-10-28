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

type DownloadChatFolderLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewDownloadChatFolderLogic(ctx context.Context, svcCtx *svc.ServiceContext) *DownloadChatFolderLogic {
	return &DownloadChatFolderLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *DownloadChatFolderLogic) DownloadChatFolder(req *types.ChatFolderRequest) (*files.Archive, error) {
	return l.svcCtx.ChatFiles.OpenFolder(l.ctx, req.Id, req.Batch, req.Folder)
}
