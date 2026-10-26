// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package middleware

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"digital-assets/backend/internal/apperror"
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/model"
	"errors"
	"github.com/zeromicro/go-zero/rest/httpx"
	"net/http"
)

type SessionMiddleware struct {
	Store *model.Store
}

func NewSessionMiddleware(store *model.Store) *SessionMiddleware {
	return &SessionMiddleware{Store: store}
}

func (m *SessionMiddleware) Handle(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(auth.CookieName)
		if err != nil || len(cookie.Value) != 64 {
			httpx.ErrorCtx(r.Context(), w, apperror.New(401, "请先登录"))
			return
		}
		s, err := m.Store.Session(r.Context(), auth.Hash(cookie.Value))
		if errors.Is(err, sql.ErrNoRows) {
			httpx.ErrorCtx(r.Context(), w, apperror.New(401, "登录已过期，请重新登录"))
			return
		}
		if err != nil {
			httpx.ErrorCtx(r.Context(), w, err)
			return
		}
		if s.MustChangePassword && r.URL.Path != "/api/v1/auth/change-password" && r.URL.Path != "/api/v1/auth/logout" && r.URL.Path != "/api/v1/auth/me" {
			httpx.ErrorCtx(r.Context(), w, apperror.New(403, "请先修改临时密码"))
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(s.Csrf)) != 1 {
			httpx.ErrorCtx(r.Context(), w, apperror.New(403, "请求验证失败，请刷新页面"))
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), auth.Key{}, s)))
	}
}
