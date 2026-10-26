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

type CreateReplyLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewCreateReplyLogic(ctx context.Context, svcCtx *svc.ServiceContext) *CreateReplyLogic {
	return &CreateReplyLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *CreateReplyLogic) CreateReply(req *types.CreateReplyRequest) (resp *types.Reply, err error) {
	if req.CommentId < 1 {
		return nil, apperror.New(400, "无效的评论编号")
	}
	content := strings.TrimSpace(req.Content)
	if utf8.RuneCountInString(content) < 1 || utf8.RuneCountInString(content) > 2000 {
		return nil, apperror.New(400, "回复内容不能为空，且不超过 2000 字")
	}
	user := auth.Current(l.ctx).User
	reply, err := l.svcCtx.Store.CreateReply(l.ctx, req.CommentId, user, content, mentionedUsernames(content))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperror.New(404, "评论不存在或不能回复此内容")
	}
	if err != nil {
		return nil, err
	}
	return &reply, nil
}
