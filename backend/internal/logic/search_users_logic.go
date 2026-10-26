// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"digital-assets/backend/internal/apperror"
	"strings"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type SearchUsersLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewSearchUsersLogic(ctx context.Context, svcCtx *svc.ServiceContext) *SearchUsersLogic {
	return &SearchUsersLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *SearchUsersLogic) SearchUsers(req *types.SearchUsersRequest) (resp *types.UsersResponse, err error) {
	if len(req.Query) > 200 {
		return nil, apperror.New(400, "搜索内容过长")
	}
	users, e := l.svcCtx.Store.Users(l.ctx, strings.TrimSpace(req.Query))
	if e != nil {
		return nil, e
	}
	return &types.UsersResponse{Items: users}, nil
}
