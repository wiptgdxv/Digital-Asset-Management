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

type ListDemoFilesLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewListDemoFilesLogic(ctx context.Context, svcCtx *svc.ServiceContext) *ListDemoFilesLogic {
	return &ListDemoFilesLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *ListDemoFilesLogic) ListDemoFiles(req *types.ProjectIDRequest) (resp *types.FilesResponse, err error) {
	return l.svcCtx.Files.List(l.ctx, req.Id, files.KindDemo)
}
