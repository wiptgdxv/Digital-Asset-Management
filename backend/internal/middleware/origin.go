package middleware

import (
	"digital-assets/backend/internal/apperror"
	"github.com/zeromicro/go-zero/rest/httpx"
	"net/http"
)

// Reject cross-site writes, including login and registration before a session exists.
func Origin(allowed string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "GET" && r.Method != "HEAD" {
				origin := r.Header.Get("Origin")
				if r.Header.Get("Sec-Fetch-Site") == "cross-site" || (origin != "" && origin != allowed) {
					httpx.ErrorCtx(r.Context(), w, apperror.New(403, "不允许跨站请求"))
					return
				}
			}
			next(w, r)
		}
	}
}
