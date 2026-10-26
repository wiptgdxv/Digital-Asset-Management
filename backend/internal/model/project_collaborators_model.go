package model

import "github.com/zeromicro/go-zero/core/stores/sqlx"

var _ ProjectCollaboratorsModel = (*customProjectCollaboratorsModel)(nil)

type (
	// ProjectCollaboratorsModel is an interface to be customized, add more methods here,
	// and implement the added methods in customProjectCollaboratorsModel.
	ProjectCollaboratorsModel interface {
		projectCollaboratorsModel
		withSession(session sqlx.Session) ProjectCollaboratorsModel
	}

	customProjectCollaboratorsModel struct {
		*defaultProjectCollaboratorsModel
	}
)

// NewProjectCollaboratorsModel returns a model for the database table.
func NewProjectCollaboratorsModel(conn sqlx.SqlConn) ProjectCollaboratorsModel {
	return &customProjectCollaboratorsModel{
		defaultProjectCollaboratorsModel: newProjectCollaboratorsModel(conn),
	}
}

func (m *customProjectCollaboratorsModel) withSession(session sqlx.Session) ProjectCollaboratorsModel {
	return NewProjectCollaboratorsModel(sqlx.NewSqlConnFromSession(session))
}
