// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package logic

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"

	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/model"
	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zeromicro/go-zero/core/logx"
)

type UpdateProjectLogic struct {
	logx.Logger
	ctx    context.Context
	svcCtx *svc.ServiceContext
}

func NewUpdateProjectLogic(ctx context.Context, svcCtx *svc.ServiceContext) *UpdateProjectLogic {
	return &UpdateProjectLogic{
		Logger: logx.WithContext(ctx),
		ctx:    ctx,
		svcCtx: svcCtx,
	}
}

func (l *UpdateProjectLogic) UpdateProject(req *types.UpdateProjectRequest) (resp *types.Project, err error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Summary = strings.TrimSpace(req.Summary)
	if req.Id < 1 || req.Version < 1 || utf8.RuneCountInString(req.Name) < 1 || utf8.RuneCountInString(req.Name) > 120 || utf8.RuneCountInString(req.Summary) > 500 || len(req.Readme) > 200000 || len(req.CollaboratorIds) > 50 || !validCategory(req.Category) {
		return nil, apperror.New(400, "请检查项目名称、分类、简介、版本或成员数量")
	}
	for _, id := range req.CollaboratorIds {
		if id < 1 {
			return nil, apperror.New(400, "无效的共创者")
		}
	}
	user := auth.Current(l.ctx).User
	p, e := l.svcCtx.Store.UpdateProject(l.ctx, req, user.Id, user.IsAdmin)
	if e == nil {
		return &p, nil
	}
	if errors.Is(e, sql.ErrNoRows) {
		return nil, apperror.New(404, "项目不存在")
	}
	if errors.Is(e, model.ErrProjectConflict) {
		return nil, apperror.New(409, "项目已被其他人更新，请加载最新版本后重试")
	}
	if errors.Is(e, model.ErrCollaboratorPermission) {
		return nil, apperror.New(403, "只有项目作者或管理员可以调整共创者")
	}
	var pg *pgconn.PgError
	if errors.As(e, &pg) && pg.Code == "23503" {
		return nil, apperror.New(400, "共创者不存在，请重新选择")
	}
	return nil, e
}
