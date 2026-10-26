package model

import "github.com/zeromicro/go-zero/core/stores/sqlx"

var _ ProjectsModel = (*customProjectsModel)(nil)

type (
	// ProjectsModel is an interface to be customized, add more methods here,
	// and implement the added methods in customProjectsModel.
	ProjectsModel interface {
		projectsModel
		withSession(session sqlx.Session) ProjectsModel
	}

	customProjectsModel struct {
		*defaultProjectsModel
	}
)

// NewProjectsModel returns a model for the database table.
func NewProjectsModel(conn sqlx.SqlConn) ProjectsModel {
	return &customProjectsModel{
		defaultProjectsModel: newProjectsModel(conn),
	}
}

func (m *customProjectsModel) withSession(session sqlx.Session) ProjectsModel {
	return NewProjectsModel(sqlx.NewSqlConnFromSession(session))
}
