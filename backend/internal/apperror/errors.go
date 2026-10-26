package apperror

import (
	"context"
	"errors"
	"github.com/zeromicro/go-zero/core/logc"
	"net/http"
)

type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string             { return e.Message }
func New(status int, message string) error { return &Error{status, message} }
func Handler(ctx context.Context, err error) (int, any) {
	var e *Error
	if errors.As(err, &e) {
		return e.Status, map[string]string{"message": e.Message}
	}
	logc.Error(ctx, "request failed")
	return http.StatusInternalServerError, map[string]string{"message": "服务暂时不可用，请稍后重试"}
}
