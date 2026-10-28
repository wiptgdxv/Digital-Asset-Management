package middleware

import (
	"net/http"
	"time"

	"github.com/zeromicro/go-zero/core/logc"
)

// SafeRequestLog deliberately avoids request/response bodies, headers and
// query strings, which may contain credentials or internal communications.
func SafeRequestLog(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next(w, r)
		logc.Infof(r.Context(), "http %s %s %s", r.Method, r.URL.Path, time.Since(started))
	}
}
