// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"database/sql"
	"errors"

	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type ListCommentsLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewListCommentsLogic(ctx context.Context, svcCtx *svc.ServiceContext) *ListCommentsLogic {
	return &ListCommentsLogic{Logger: logx.WithContext(ctx), ctx: ctx, svcCtx: svcCtx}
}

func (l *ListCommentsLogic) ListComments(req *types.ProjectIDRequest) (resp *types.CommentsResponse, err error) {
	if req.Id < 1 {
		return nil, apperror.New(400, "无效的项目编号")
	}
	comments, err := l.svcCtx.Store.Comments(l.ctx, req.Id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "项目不存在")
	}
	if err != nil {
		return nil, err
	}
	return &types.CommentsResponse{Items: comments}, nil
}
