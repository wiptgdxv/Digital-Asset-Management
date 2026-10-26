// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package handler

import (
	"digital-assets/backend/internal/auth"
	"net/http"

	"digital-assets/backend/internal/logic"
	"digital-assets/backend/internal/svc"
	"github.com/zeromicro/go-zero/rest/httpx"
)

func LogoutHandler(svcCtx *svc.ServiceContext) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		l := logic.NewLogoutLogic(r.Context(), svcCtx)
		resp, err := l.Logout()
		if err != nil {
			httpx.ErrorCtx(r.Context(), w, err)
		} else {
			http.SetCookie(w, auth.Cookie("", svcCtx.Config.CookieSecure, -1))
			httpx.OkJsonCtx(r.Context(), w, resp)
		}
	}
}
