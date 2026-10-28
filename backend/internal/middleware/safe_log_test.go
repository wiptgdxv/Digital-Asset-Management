package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zeromicro/go-zero/core/logx/logtest"
)

func TestSafeRequestLogDoesNotRecordPrivateData(t *testing.T) {
	logs := logtest.NewCollector(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/chat/conversations/1/messages?query-secret", strings.NewReader("private-message-body"))
	req.Header.Set("Cookie", "secret-cookie")
	SafeRequestLog(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusInternalServerError)
	})(httptest.NewRecorder(), req)
	text := logs.String()
	for _, secret := range []string{"query-secret", "private-message-body", "secret-cookie"} {
		if strings.Contains(text, secret) {
			t.Fatalf("request log exposed %s", secret)
		}
	}
}
