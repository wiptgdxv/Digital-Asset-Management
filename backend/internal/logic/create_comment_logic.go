package logic

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"

	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type CreateCommentLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewCreateCommentLogic(ctx context.Context, svcCtx *svc.ServiceContext) *CreateCommentLogic {
	return &CreateCommentLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *CreateCommentLogic) CreateComment(req *types.CreateCommentRequest) (resp *types.Comment, err error) {
	if req.ProjectId < 1 {
		return nil, apperror.New(400, "无效的项目编号")
	}
	content := strings.TrimSpace(req.Content)
	if utf8.RuneCountInString(content) < 1 || utf8.RuneCountInString(content) > 2000 {
		return nil, apperror.New(400, "评论内容不能为空，且不超过 2000 字")
	}
	user := auth.Current(l.ctx).User
	comment, err := l.svcCtx.Store.CreateComment(l.ctx, req.ProjectId, user, content, mentionedUsernames(content))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "项目不存在")
	}
	if err != nil {
		return nil, err
	}
	return &comment, nil
}
