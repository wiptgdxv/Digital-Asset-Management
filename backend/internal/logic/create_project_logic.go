// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"errors"
	"github.com/jackc/pgx/v5/pgconn"
	"strings"
	"unicode/utf8"

	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/zeromicro/go-zero/core/logx"
)

type CreateProjectLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewCreateProjectLogic(ctx context.Context, svcCtx *svc.ServiceContext) *CreateProjectLogic {
	return &CreateProjectLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *CreateProjectLogic) CreateProject(req *types.ProjectRequest) (resp *types.Project, err error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Summary = strings.TrimSpace(req.Summary)
	if utf8.RuneCountInString(req.Name) < 1 || utf8.RuneCountInString(req.Name) > 120 || utf8.RuneCountInString(req.Summary) > 500 || len(req.Readme) > 200000 || len(req.CollaboratorIds) > 50 || !validCategory(req.Category) {
		return nil, apperror.New(400, "请检查项目名称、分类、简介或成员数量")
	}
	for _, id := range req.CollaboratorIds {
		if id < 1 {
			return nil, apperror.New(400, "无效的共创者")
		}
	}
	id, e := l.svcCtx.Store.CreateProject(l.ctx, req, auth.Current(l.ctx).User.Id)
	if e != nil {
		var pg *pgconn.PgError
		if errors.As(e, &pg) && pg.Code == "23503" {
			return nil, apperror.New(400, "共创者不存在，请重新选择")
		}
		return nil, e
	}
	p, e := l.svcCtx.Store.Project(l.ctx, id)
	return &p, e
}
